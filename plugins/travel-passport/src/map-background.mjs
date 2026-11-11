import {frameContains,frameFor} from './map-frames.mjs';
import {geometryPoints,geometryContains} from './geographic-fit.mjs';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rings=g=>g.type==='Polygon'?g.coordinates:g.type==='MultiPolygon'?g.coordinates.flat():g.type==='LineString'?[g.coordinates]:g.coordinates;
const path=(g,frame)=>rings(g).map(r=>r.map(([lon,lat],i)=>{const [x,y]=frame.project([lat,lon]);return `${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`;}).join('')+(g.type.includes('Polygon')?'Z':'')).join('');
const overlap=(a,b)=>a.x<b.x+b.w+7&&a.x+a.w+7>b.x&&a.y<b.y+b.h+5&&a.y+a.h+5>b.y;
const anchor=g=>{const ps=geometryPoints(g),xs=ps.map(p=>p[0]),ys=ps.map(p=>p[1]);return [(Math.min(...ys)+Math.max(...ys))/2,(Math.min(...xs)+Math.max(...xs))/2];};
const riverNames={Ganges:'恒河',Brahmaputra:'布拉马普特拉河',Godavari:'戈达瓦里河',Krishna:'克里希纳河',Narmada:'纳尔默达河',Indus:'印度河'};

export function backgroundMarkup(data,view,frames,geo,reserved=[]){
  if(!data.background||view.scope.id==='world')return '';
  const background=data.background,codes=new Set(view.scope.backgroundCodes),parts=[],candidates=[];
  const knownUnits=new Map(view.scope.units.flatMap(u=>[[u.id,u.name],...(u.mapId?[[u.mapId,u.name]]:[])]));
  const places=view.nodes.map(n=>{const f=frameFor(frames,n),[x,y]=f.project([n.lat,n.lon]);return {x:x-12,y:y-12,w:24,h:24};});
  for(const [i,frame]of frames.entries()){
    const relevant=geo?.features.filter(f=>(!view.scope.unitId||f.id===view.scope.unitId)&&(!frame.ids||frame.ids.includes(f.id)))||[];
    const [x,y,w,h]=frame.extent,id='backdrop-'+i;
    parts.push(`<defs><clipPath id="${id}">${relevant.length?relevant.map(f=>`<path d="${path(f.geometry,frame)}" clip-rule="evenodd"/>`).join(''):`<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`}</clipPath></defs><g clip-path="url(#atlas-frame-${i})"><g class="geographic-context" clip-path="url(#${id})">`);
    const within=point=>frameContains(frame,point)&&(!relevant.length||relevant.some(f=>geometryContains(point,f.geometry,(frame.bounds[0]+frame.bounds[2])/2)));
    const visible=f=>geometryPoints(f.geometry).some(([lon,lat])=>frameContains(frame,[lat,lon]));
    if(view.scope.placeCoverage)for(const f of background.regions.filter(f=>codes.has(f.properties.code)&&visible(f))){parts.push(`<path class="background-admin" d="${path(f.geometry,frame)}"/>`);candidates.push({point:anchor(f.geometry),name:f.properties.name,kind:'admin',frame});}
    else if(!view.scope.unitId)for(const f of relevant){const name=knownUnits.get(f.id);if(name)candidates.push({point:anchor(f.geometry),name,kind:'admin',frame});}
    for(const f of background.lakes.filter(visible))parts.push(`<path class="background-lake" d="${path(f.geometry,frame)}"/>`);
    for(const f of background.rivers.filter(visible)){
      parts.push(`<path class="background-river" d="${path(f.geometry,frame)}"/>`);
      if(f.properties.rank<=3){const ps=geometryPoints(f.geometry),p=ps[Math.floor(ps.length/2)];candidates.push({point:[p[1],p[0]],name:riverNames[f.properties.name]||f.properties.name,kind:'river',frame});}
    }
    for(const f of background.cities.filter(f=>codes.has(f.properties.code)&&within([f.geometry.coordinates[1],f.geometry.coordinates[0]])).sort((a,b)=>b.properties.population-a.properties.population).slice(0,24)){
      const [lon,lat]=f.geometry.coordinates,[cx,cy]=frame.project([lat,lon]);parts.push(`<circle class="background-city" cx="${cx}" cy="${cy}" r="1.2"/>`);
      candidates.push({point:[lat,lon],name:f.properties.name,kind:'city',frame,population:f.properties.population});
    }parts.push('</g></g>');
    for(const c of candidates.filter(c=>c.frame===frame))c.within=within(c.point);
  }
  const boxes=[...reserved,...places],counts={admin:0,city:0,river:0};
  for(const c of candidates){if(!c.name||!c.within||counts[c.kind]>=(c.kind==='admin'?16:c.kind==='city'?8:4)||!frameContains(c.frame,c.point))continue;
    const [x,y]=c.frame.project(c.point),width=Array.from(c.name).reduce((sum,char)=>sum+(/[\u0000-\u007f]/.test(char)?5.6:10.5),0),box={x:x-width/2,y:y-11,w:width,h:14};
    const [fx,fy,fw,fh]=c.frame.extent;if(box.x<fx+8||box.x+box.w>fx+fw-8||box.y<fy+8||box.y+box.h>fy+fh-8||boxes.some(b=>overlap(box,b)))continue;
    boxes.push(box);counts[c.kind]++;parts.push(`<text class="background-label ${c.kind}" x="${x}" y="${y}" text-anchor="middle">${esc(c.name)}</text>`);
  }
  return `<g aria-label="公共地理背景，非到访记录"><style>.dot{opacity:.3}.dot.active{opacity:.38}.geographic-context{pointer-events:none}.background-admin{fill:none;stroke:#92a99c;stroke-width:1;opacity:.8}.background-river{fill:none;stroke:#94b8be;stroke-width:1.15;opacity:.65}.background-lake{fill:#bad3d2;stroke:#9cbec2;stroke-width:.6;opacity:.6}.background-city{fill:#8a9f95;opacity:.55}.background-label{font:10.5px 'Helvetica Neue','PingFang SC',sans-serif;fill:#728777;paint-order:stroke;stroke:#f7f8ef;stroke-width:2;pointer-events:none}.background-label.river{fill:#79a5ae;font-style:italic}</style>${parts.join('')}</g>`;
}
