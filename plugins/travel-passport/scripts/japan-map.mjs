import { feature } from 'topojson-client';
import { routeSegments,arcPath } from './route-geometry.mjs';
import { borderRouteEndpoints,goesEast,renderEdgeLabels } from './edge-labels.mjs';
import { isRecordedMovement } from '../src/route-semantics.mjs';
import { placeLabels } from '../src/map-labels.mjs';

const esc = s => String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const merc = lat => Math.log(Math.tan(Math.PI/4+lat*Math.PI/360));
export function projector(bounds, extent) {
  const [west,south,east,north] = bounds, [x,y,w,h] = extent;
  const top=merc(north), bottom=merc(south);
  const scale=Math.min(w/((east-west)*Math.PI/180),h/(top-bottom));
  const dx=x+(w-(east-west)*Math.PI/180*scale)/2;
  const dy=y+(h-(top-bottom)*scale)/2;
  return ([lat,lon]) => [dx+(lon-west)*Math.PI/180*scale,dy+(top-merc(lat))*scale];
}
function inRing([x,y],ring) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [xi,yi]=ring[i],[xj,yj]=ring[j];
    if((yi>y)!==(yj>y) && x<(xj-xi)*(y-yi)/(yj-yi)+xi) inside=!inside;
  }
  return inside;
}
const inPoly = (p,poly) => inRing(p,poly[0]) && !poly.slice(1).some(r=>inRing(p,r));
function geometryParts(f) {
  const polys=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
  return polys.map(poly=>{
    const ring=poly[0],xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]);
    return {poly,bounds:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]};
  });
}

export function japanMap(topology, atlas, { aliases } = {}) {
  const features=feature(topology,topology.objects.japan).features;
  const ids=features.map(f=>String(f.properties.id).padStart(2,'0'));
  if(new Set(ids).size!==47 || !atlas.prefectures.every(p=>ids.includes(p.id))) throw new Error('日本地图须完整包含47个都道府县');
  const main=projector([128.3,30.3,146.3,45.8],[10,8,980,650]);
  const inset=projector([122.8,24,129,28.2],[735,470,228,150]);
  const visited=new Set(atlas.prefectures.filter(p=>p.visited).map(p=>p.id));
  const parts=[];
  for(const f of features) {
    const id=String(f.properties.id).padStart(2,'0'), project=id==='47'?inset:main;
    const polygons=geometryParts(f).filter(p=>id==='47'||p.bounds[1]>=29);
    // Outlying remote islands are omitted from the mainland plate, never moved.
    const path=polygons.map(({poly})=>poly.map(ring=>ring.map((point,i)=>{
      const [x,y]=project([point[1],point[0]]);
      return `${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join('')+'Z').join('')).join('');
    parts.push(`<path class="prefecture${visited.has(id)?' visited':''}" data-prefecture="${id}" d="${path}" fill-rule="evenodd"><title>${esc(atlas.prefectures.find(p=>p.id===id).name)}</title></path>`);
    for(const {poly,bounds:[w,s,e,n]} of polygons) {
      const step=id==='47'?.1:.115;
      for(let lon=Math.ceil(w/step)*step;lon<=e;lon+=step)for(let lat=Math.ceil(s/step)*step;lat<=n;lat+=step) {
        if(!inPoly([lon,lat],poly))continue;
        const [x,y]=project([lat,lon]);
        parts.push(`<circle class="jp-dot${visited.has(id)?' visited':''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.25"/>`);
      }
    }
  }
  const borderRoutes=atlas.routes.filter(r=>isRecordedMovement(r)&&r.countries?.some(c=>c==='日本')&&r.countries?.some(c=>c!=='日本'));
  const mainBorderRoutes=borderRoutes.filter(r=>{const edge=borderRouteEndpoints(r,['日本']);return edge&&edge.home[0]>=29;});
  const insetBorderRoutes=borderRoutes.map(r=>borderRouteEndpoints(r,['日本'])).filter(edge=>edge&&edge.home[0]<29);
  const edge=renderEdgeLabels({
    routes:mainBorderRoutes,
    regionCountries:['日本'],bounds:[128.3,30.3,146.3,45.8],project:main,extent:[10,8,980,650],gap:30,aliases,
  });
  // Okinawa is drawn in a separate inset. A Hong Kong↔Naha flight therefore
  // connects to the inset frame, rather than being projected onto Kyushu's
  // southern edge and mistaken for a mainland Japan route.
  const insetGroups=new Map();
  for(const item of insetBorderRoutes){
    const awayName=aliases?.get(item.awayName)||item.awayName;
    const key=`${goesEast(item.home,item.away)?'E':'W'}|${awayName}`;
    if(!insetGroups.has(key))insetGroups.set(key,{east:goesEast(item.home,item.away),awayName,links:new Map()});
    insetGroups.get(key).links.set(`${item.homeName}|${item.mode}`,{point:inset(item.home),mode:item.mode});
  }
  const insetList=[...insetGroups.values()];
  for(const group of insetList){const links=[...group.links.values()];group.y=links.reduce((sum,link)=>sum+link.point[1],0)/links.length;}
  insetList.sort((a,b)=>a.y-b.y);
  for(let i=1;i<insetList.length;i++)if(insetList[i].y-insetList[i-1].y<24)insetList[i].y=insetList[i-1].y+24;
  for(const group of insetList){
    const x=group.east?963:735,tx=group.east?900:770,anchor=group.east?'start':'end';
    for(const link of group.links.values())parts.push(`<path class="jp-route edge${link.mode==='飞机'?' air':''}" data-edge="true" data-edge-mode="${link.mode}" d="${arcPath(link.point,[x,group.y],link.mode)}"/>`);
    parts.push(`<circle class="jp-edge-dot" data-edge-label="true" cx="${x}" cy="${group.y.toFixed(1)}" r="2.4"/><path class="jp-leader" d="M${x},${group.y.toFixed(1)}h${(tx-x).toFixed(1)}"/><text class="jp-label jp-edge-label" data-edge-label="true" x="${tx}" y="${(group.y+5).toFixed(1)}" text-anchor="${anchor}">${esc(group.awayName)}</text>`);
  }
  parts.push(edge.svg);
  for(const leg of routeSegments(atlas.routes.filter(r=>r.countries?.length&&r.countries.every(c=>c==='日本')))){
    if(leg.a[0]<29||leg.b[0]<29)continue;
    parts.push(`<path class="jp-route${leg.mode==='飞机'?' air':''}${leg.structuralLink?' structural':''}" data-route="true" data-type="${leg.structuralLink?'structural':'movement'}" data-structural="${leg.structuralLink}" data-count="${leg.count}" d="${arcPath(main(leg.a),main(leg.b),leg.mode)}"/>`);
  }
  const points=atlas.places.filter(p=>p.status==='已到访'&&p.include!==false&&p.lat!==null&&p.lon!==null);
  for(const p of points) {
    const [x,y]=(p.prefectureId==='47'?inset:main)([p.lat,p.lon]);
    parts.push(`<circle class="jp-place" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.8"><title>${esc(p.name)}</title></circle>`);
  }
  const frames=[
    {bounds:[128.3,30.3,146.3,45.8],extent:[10,8,980,650],project:main},
    {bounds:[122.8,24,129,28.2],extent:[735,470,228,150],project:inset},
  ];
  const labelRoutes=atlas.routes.filter(isRecordedMovement).map(route=>({...route,
    nodes:route.nodes||(route.displayPoints||route.points||[]).map((_,i)=>({
      id:route.nodeRefs?.[i]?.placeId||route.nodeRefs?.[i]?.id,name:(route.displayNames||route.names||[])[i]||route.nodeRefs?.[i]?.name,
    })),
  }));
  const labels=placeLabels({scope:{id:'japan'},places:points,routes:labelRoutes},frames,(all,p)=>all.find(frame=>{
    const [lat,lon]=[p.lat,p.lon];return lon>=frame.bounds[0]&&lon<=frame.bounds[2]&&lat>=frame.bounds[1]&&lat<=frame.bounds[3];
  })||frames[0]);
  for(const label of labels) {
    parts.push(`<path class="jp-leader" d="M${label.nodeX},${label.nodeY}L${label.x+(label.anchor==='end'?4:-4)},${label.y-5}"/>`);
    parts.push(`<text class="jp-label" data-place-label="${esc(label.id)}" x="${label.x}" y="${label.y}" text-anchor="${label.anchor}">${esc(label.name)}</text>`);
  }
  parts.push('<path class="inset-rule" d="M725 450H978V638H725"/><text class="jp-inset-title" x="750" y="445">冲绳诸岛</text>');
  const attribution=[topology.attribution,topology.metadata?.attribution,topology.metadata?.source,topology.source]
    .find(value=>typeof value==='string'&&value.trim())||'行政边界 · 来源见 NOTICE.md';
  parts.push(`<text class="map-source" x="990" y="677" text-anchor="end">地图：${esc(attribution)}</text>`);
  return `<svg id="japanMap" viewBox="0 0 1000 690" role="img" aria-label="日本47都道府县地图；${atlas.japan.visited}个已到访县为青绿色，${atlas.japan.cities}个已核到访城市与城镇为红点">${parts.join('')}</svg>`;
}
