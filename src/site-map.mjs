import {curvedPath} from './scope-model.mjs';
import {mapFrames,frameProject,frameFor,frameContains} from './map-frames.mjs';
import {sampleMapDots} from './map-dots.mjs';
import {placeLabels} from './map-labels.mjs';
import {cityMapMarkup} from './city-map.mjs';
import {gatewayIdentity} from './city-gateways.mjs';
import {backgroundMarkup} from './map-background.mjs';
import {isStructuralRoute,isRecordedMovement,orderedDisplayRoutes} from './route-semantics.mjs';
import {cityPassportSummary} from './city-passport-summary.mjs';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const MAP_STYLE=`.land{fill:#b4cfdf;fill-opacity:.09;stroke:#8db5c1;stroke-width:.7;stroke-linejoin:round}.land.active{fill:#49aaa1;fill-opacity:.1;stroke:#70aaa6}.dot{fill:#a4c7d6;opacity:.8;pointer-events:none}.dot.active{fill:#3da69e;opacity:.94}.route{fill:none;stroke:#6b8e77;stroke-width:1.25;opacity:.7;stroke-linecap:round;pointer-events:none}.route.air{stroke:#aa682f;stroke-width:1.4;opacity:.7}.route.structural{stroke:#a0ab9c;stroke-width:.8;stroke-dasharray:2 5;opacity:.25}.route.edge{stroke:#b28768;stroke-dasharray:4 5;opacity:.48}.stop{fill:#dc6b58;stroke:#8b4838;stroke-width:.6;cursor:pointer}.transfer{fill:#83aabf;opacity:.8}.gateway{fill:#f7f8ef;stroke:#aa682f;stroke-width:1.4}.map-label{fill:#4b6574;font:14px 'Helvetica Neue',Arial,'PingFang SC',sans-serif;paint-order:stroke;stroke:#f7f8ef;stroke-width:3;stroke-linejoin:round;pointer-events:none}.edge-label{fill:#897765;font-size:12px;font-weight:600}.map-source{fill:#73898b;font:9px Arial,'PingFang SC',sans-serif}.inset-rule{fill:none;stroke:#b0c6c5;stroke-width:1;stroke-dasharray:4 5}.land:hover{stroke:#3da69e;stroke-width:1.5;cursor:pointer}`;
const point=n=>[n.lat,n.lon];
const inBounds=([lat,lon],[w,s,e,n])=>lon>=w&&lon<=e&&lat>=s&&lat<=n;
const polygons=g=>g.type==='Polygon'?[g.coordinates]:g.coordinates;
const caches=new WeakMap();

export function mapMarkup(data,engine,view){
  if(view.scope.cityId)return cityMapMarkup(data,engine,view);
  if(!caches.has(data))caches.set(data,new Map());const cache=caches.get(data);
  if(cache.has(view.scope.id))return cache.get(view.scope.id);
  const {scope}=view,frames=mapFrames(scope).map(f=>({...f,project:frameProject(f)})),parts=[],reserved=[];
  const ownGeo=data.geometries[scope.geometryParent||scope.id],baseGeo=ownGeo||data.geometries.world;
  const active=new Set(view.units.filter(u=>u.active).flatMap(u=>[u.id,u.mapId].filter(Boolean)));
  const defs=frames.map((f,i)=>{const [x,y,w,h]=f.extent;return `<clipPath id="atlas-frame-${i}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath>`;}).join('');
  if(baseGeo)for(const f of baseGeo.features){
    if(scope.unitId&&f.id!==scope.unitId)continue;
    if(!ownGeo&&scope.id!=='world'&&!scope.countries.includes(f.id))continue;
    const frame=frameFor(frames,{unitId:f.id}),fi=frames.indexOf(frame);
    const poly=polygons(f.geometry).map(poly=>f.id==='US-AK'?poly.map(r=>r.map(([lon,lat])=>[lon>0?lon-360:lon,lat])):poly);
    const path=poly.filter(poly=>poly[0].some(([lon,lat])=>inBounds([lat,lon],frame.bounds))).map(poly=>poly.map(ring=>{
      let previous;return ring.map(([rawLon,lat],i)=>{
        let lon=rawLon;if(scope.id==='world'&&previous!==undefined){while(lon-previous>180)lon-=360;while(lon-previous< -180)lon+=360;}previous=lon;
        const [x,y]=frame.project([lat,lon]);return `${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`;
      }).join('')+'Z';
    }).join('')).join('');
    if(!path)continue;
    const u=scope.units.find(u=>u.id===f.id||u.mapId===f.id);
    parts.push(`<path class="land${active.has(f.id)||(scope.unitId||scope.placeCoverage)&&view.places.length?' active':''}" data-unit="${esc(f.id)}" fill-rule="evenodd" clip-path="url(#atlas-frame-${fi})" d="${path}"><title>${esc(u?.name||scope.placeCoverage&&scope.name||f.id)}</title></path>`);
    if(scope.id==='world')for(const shift of [-1,1]){const width=frame.project([0,180])[0]-frame.project([0,-180])[0];
      parts.push(`<g clip-path="url(#atlas-frame-${fi})"><path class="land${active.has(f.id)?' active':''}" data-unit="${esc(f.id)}" fill-rule="evenodd" transform="translate(${shift*width} 0)" d="${path}"><title>${esc(u?.name||f.id)}</title></path></g>`);}
  }
  const dots=scope.unitId&&ownGeo?sampleMapDots({...scope,step:0},{features:ownGeo.features.filter(f=>f.id===scope.unitId)}):data.mapDots?.[scope.id]||data.dots,visited=new Set(view.places.map(p=>p.country));
  for(const c of scope.coverage||[])visited.add(c);
  for(const [lon,lat,id]of dots){
    if(scope.unitId&&id!==scope.unitId)continue;
    if(!ownGeo&&scope.id!=='world'&&!scope.countries.includes(id))continue;
    const frame=frameFor(frames,{unitId:id});if(!frameContains(frame,[lat,lon]))continue;
    const [x,y]=frame.project([lat,lon]),on=ownGeo?active.has(id)||(scope.unitId||scope.placeCoverage)&&view.places.length:visited.has(id);
    parts.push(`<circle class="dot${on?' active':''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${scope.id==='world'?.75:1.25}"/>`);
  }
  const backdropIndex=parts.length,seen=new Set(),gateways=new Map(),recorded=view.routes.filter(isRecordedMovement),displayRoutes=orderedDisplayRoutes(view.routes).sort((a,b)=>Number(isStructuralRoute(a))-Number(isStructuralRoute(b))||Number(a.mode==='飞机')-Number(b.mode==='飞机'));
  const gatewayCatalog=data.gatewayCatalog||[],gatewayFor=n=>gatewayIdentity(n,{scope,catalog:gatewayCatalog});
  const pair=(a,b)=>[a,b].map(n=>n.lat.toFixed(5)+','+n.lon.toFixed(5)).join('>');
  const recordedPairs=new Set(recorded.flatMap(r=>r.nodes.slice(1).map((n,i)=>pair(r.nodes[i],n))));
  for(const r of displayRoutes)for(let i=1;i<r.nodes.length;i++){
    const from=r.nodes[i-1],to=r.nodes[i],aIn=engine.contains(scope,from),bIn=engine.contains(scope,to);
    if(!aIn&&!bIn)continue;
    const structural=isStructuralRoute(r);
    if(structural&&(!aIn||!bIn||recordedPairs.has(pair(from,to))))continue;
    const key=`${r.mode}|${from.lat},${from.lon}>${to.lat},${to.lon}`;if(seen.has(key))continue;seen.add(key);
    if(aIn&&bIn){
      const af=frameFor(frames,from),bf=frameFor(frames,to);
      const crossing=scope.id==='world'&&Math.abs(to.lon-from.lon)>180;
      const end=crossing?[to.lat,to.lon+(to.lon<from.lon?360:-360)]:point(to);
      const a=af.project(point(from)),b=bf.project(end),d=curvedPath(a,b,r.mode);
      if(d){const title=`<title>${esc(from.name)} → ${esc(to.name)} · ${esc(structural?'必要接续，路径未恢复':r.mode)}</title>`,cls=`route${structural?' structural':r.mode==='飞机'?' air':''}`;
        parts.push(`<path class="${cls}"${structural?' data-structural-link="true"':''} d="${d}" clip-path="url(#atlas-clip)">${title}</path>`);
        if(crossing){const width=af.project([0,180])[0]-af.project([0,-180])[0],shift=to.lon<from.lon?-width:width;
          parts.push(`<path class="${cls}"${structural?' data-structural-link="true"':''} d="${curvedPath([a[0]+shift,a[1]],[b[0]+shift,b[1]],r.mode)}" clip-path="url(#atlas-clip)">${title}</path>`);}
      }
    }else{
      const home=aIn?from:to,away=aIn?to:from,fi=frames.indexOf(frameFor(frames,home)),identity=gatewayFor(away);
      const east=((away.lon-home.lon+540)%360)-180>=0,gkey=`${fi}|${east?'E':'W'}|${identity.key}`;
      if(!gateways.has(gkey))gateways.set(gkey,{away,identity,east,fi,links:[]});
      gateways.get(gkey).links.push({home,mode:r.mode,inbound:!aIn});
    }
  }
  for(const [fi,frame]of frames.entries()){
    if(fi){const [x,y,w,h]=frame.extent;parts.push(`<rect class="inset-rule" x="${x-7}" y="${y-8}" width="${w+14}" height="${h+16}"/><text class="map-label" x="${x}" y="${y-18}">${esc(frame.label)}</text>`);}
    for(const east of [false,true]){
      const side=[...gateways.values()].filter(g=>g.fi===fi&&g.east===east).sort((a,b)=>b.away.lat-a.away.lat);
      const [x,y,w,h]=frame.extent,gap=Math.min(26,(h-35)/Math.max(side.length,1));
      side.forEach((g,i)=>{
        g.x=fi?(east?x+w+7:x-7):(east?900:100);g.y=y+h/2+(i-(side.length-1)/2)*gap;
        for(const l of g.links){const home=frame.project(point(l.home)),edge=[g.x,g.y];
          const label=g.identity?.name||g.away.name;
          parts.push(`<path class="route edge${l.mode==='飞机'?' air':''}" data-gateway-kind="${esc(g.identity?.kind||'city')}" d="${curvedPath(l.inbound?edge:home,l.inbound?home:edge,l.mode)}"><title>${esc(l.inbound?label:l.home.name)} → ${esc(l.inbound?l.home.name:label)}</title></path>`);}
        const label=g.identity?.name||g.away.name,kind=g.identity?.kind||'city',description=g.identity?.description||label;
        parts.push(`<circle class="gateway" data-gateway-kind="${esc(kind)}" cx="${g.x}" cy="${g.y}" r="2.8"/><text class="map-label edge-label" data-gateway-kind="${esc(kind)}" x="${g.x+(east?9:-9)}" y="${g.y+4}" text-anchor="${east?'start':'end'}"><title>${esc(kind==='unknown'?description:label)}</title>${esc(label)}</text>`);
        const width=[...label].length*13;reserved.push({x:east?g.x+6:g.x-9-width,y:g.y-12,w:width+3,h:18});
      });
    }
  }
  const shownNodes=new Set([...displayRoutes.flatMap(r=>r.nodes.map(n=>n.id)),...view.places.map(p=>p.id)]);
  for(const n of view.nodes.filter(n=>shownNodes.has(n.id))){
    const frame=frameFor(frames,n);if(!frameContains(frame,point(n)))continue;
    const [x,y]=frame.project(point(n));
    parts.push(`<circle class="${n.visited?'stop':'transfer'}" data-node="${esc(n.id)}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${n.visited?2.5:1.3}"><title>${esc(n.name)}</title></circle>`);
  }
  const labels=placeLabels({...view,routes:recorded},frames,frameFor,reserved);
  for(const label of labels){
    const {id,name,x,y,anchor,nodeX,nodeY}=label;
    parts.push(`<path d="M${nodeX},${nodeY}L${x+(anchor==='end'?4:-4)},${y-5}" fill="none" stroke="#94a39d" stroke-width=".7" pointer-events="none"/><text class="map-label place-label" data-place-label="${esc(id)}" x="${x}" y="${y}" text-anchor="${anchor}">${esc(name)}</text>`);
  }
  parts.splice(backdropIndex,0,backgroundMarkup(data,view,frames,baseGeo,[...reserved,...labels.map(l=>l.box)]));
  parts.push(`<text class="map-source" x="500" y="628" text-anchor="middle">${esc(scope.source||'')} · ${esc(scope.name)}</text>`);
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 640" role="img" aria-label="${esc(scope.name)}旅行地图"><style>${MAP_STYLE}</style><defs>${defs}<clipPath id="atlas-clip"><rect width="1000" height="640"/></clipPath></defs>${parts.join('')}</svg>`;
  cache.set(scope.id,svg);return svg;
}
export function passportLines(view){
  const {scope,stats}=view,slug=scope.english.toUpperCase().replace(/[^A-Z0-9 ]/g,'').replaceAll(' ','<')||scope.id.toUpperCase().replace(/[^A-Z0-9]/g,'<');
  const city=cityPassportSummary(view),content=city?`${stats.firstYear||''}<<${stats.lastYear||''}<<${city.places}PLACES<<${stats.visited}/${stats.total}REG<<${city.activities}ACT`:`${stats.firstYear||''}<<${stats.lastYear||''}<<${stats.km}KM<<${stats.visited}/${stats.total}REG<<${stats.places}PLACES`;
  return [`P<CHN<${slug}<TRAVEL<PASSPORT`,content].map(l=>(l.slice(0,44)+'<'.repeat(44)).slice(0,44));
}
export function passportSvg(data,engine,view){
  const svg=passportMarkup(data,engine,view);
  if(!view.scope.cityId||view.evidence?.retainedTracks===undefined)return svg;
  const fmt=n=>n.toLocaleString('en-US'),caption=fmt(view.tracks.length)+' 段定位轨迹 · '+fmt(view.photoPoints.length)+' 张定位照片 · '+fmt(view.observationDays.length)+' 个记录日';
  return svg.replace(/<\/g><\/svg>$/,`<text x="70" y="925" font-size="15" fill="#638d9c">${esc(caption)}</text></g></svg>`);
}
function passportMarkup(data,engine,view){
  const {scope,stats}=view,fmt=n=>n.toLocaleString('en-US');
  const map=mapMarkup(data,engine,view).replace('<svg xmlns=', '<svg x="60" y="140" width="1000" height="640" xmlns=');
  const units=view.units.filter(u=>u.active).map(u=>u.name),lines=[];let line='';
  for(const name of units){if((line+name).length>45){lines.push(line);line='';}line+=(line?' · ':'')+name;}if(line)lines.push(line);
  const simple=scope.id==='world'||scope.placeCoverage||scope.unitId||scope.cityId;
  const city=cityPassportSummary(view);
  const hero=city?fmt(city.places):simple?fmt(stats.km):stats.visited,heroSuffix=city?'地点':simple?'公里':`/ ${stats.total}`;
  const heroLabel=city?'已核到访地点':simple?'累计旅行里程':scope.unitLabel;
  const supporting=city?city.supporting:[{value:simple?stats.visited:stats.km,label:simple?scope.unitLabel:'公里旅程'},{value:stats.places,label:'地点'},{value:stats.travelHours,label:'小时移动'}];
  const supportingMarkup=supporting.map((m,i)=>`<text x="${supporting.length===2?[70,560][i]:[70,480,770][i]}" y="1280" font-size="34" font-weight="600">${esc(typeof m.value==='number'?fmt(m.value):m.value)}<tspan font-size="16" font-weight="400" fill="#53649d"> ${esc(m.label)}</tspan></text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="1494" viewBox="0 0 1120 1494"><defs><pattern id="security" width="360" height="65" patternUnits="userSpaceOnUse"><path d="M-90 32Q-45 13 0 32T90 32T180 32T270 32T360 32T450 32" fill="none" stroke="#8cbda1" stroke-opacity=".14"/></pattern></defs><rect width="1120" height="1494" rx="40" fill="#092574"/><rect x="0" y="20" width="1120" height="1454" rx="36" fill="#f7f8ef"/><rect x="0" y="20" width="1120" height="1454" rx="36" fill="url(#security)"/><g fill="#202b39" font-family="Helvetica Neue,Arial,PingFang SC,sans-serif"><text x="70" y="100" font-size="15" fill="#638d9c" letter-spacing="3">${esc(scope.english.toUpperCase())} JOURNEYS</text><text x="1050" y="100" font-size="15" fill="#638d9c" text-anchor="end" letter-spacing="2">${stats.firstYear||''} — ${stats.lastYear||''}</text>${map}${lines.slice(0,4).map((l,i)=>`<text x="70" y="${810+i*28}" font-size="16" fill="#466776">${esc(l)}</text>`).join('')}<path d="M70 945H1050" stroke="#cbd5ce" stroke-width="2" stroke-dasharray="6 5"/><text x="70" y="1005" font-size="40" font-weight="600" fill="#173575">${esc(scope.name)}旅行护照</text><text x="70" y="1035" font-size="16" fill="#53649d" letter-spacing="3">${esc(scope.english.toUpperCase())} TRAVEL PASSPORT</text><text x="70" y="1080" font-size="17" fill="#53649d">${esc(heroLabel)}</text><text x="70" y="1185" font-size="110" font-weight="700" letter-spacing="-4">${hero}<tspan font-size="34" font-weight="400" letter-spacing="0" fill="#7b95a3"> ${heroSuffix}</tspan></text><text x="850" y="1130" font-size="58" font-weight="600" fill="#173575">${scope.districtId||scope.unitId||scope.placeCoverage?stats.places:(stats.percent||0)+'%'}</text><text x="850" y="1168" font-size="18" fill="#53649d">${scope.districtId||scope.unitId||scope.placeCoverage?'旅行地点':'足迹覆盖'}</text><path d="M70 1220H1050" stroke="#d4dcd4"/>${supportingMarkup}<path d="M70 1340H1050" stroke="#d4dcd4"/>${passportLines(view).map((l,i)=>`<text x="70" y="${1382+i*35}" font-family="Menlo,monospace" fill="#829087" font-size="29">${esc(l)}</text>`).join('')}</g></svg>`;
}
