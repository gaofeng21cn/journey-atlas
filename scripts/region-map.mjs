import { projector } from './japan-map.mjs';
import { routeSegments,arcPath } from './route-geometry.mjs';
import { renderEdgeLabels } from './edge-labels.mjs';
import { isRecordedMovement } from '../src/route-semantics.mjs';
import { pointInFeature,pointInRing } from '../src/scope-model.mjs';
import { placeLabels } from '../src/map-labels.mjs';
export const escapeHtml=s=>String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export { pointInFeature };
const polygons=f=>f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[];
const boundsFor=poly=>{const r=poly[0],xs=r.map(p=>p[0]),ys=r.map(p=>p[1]);return[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];};
const intersects=(a,b)=>a[2]>=b[0]&&a[0]<=b[2]&&a[3]>=b[1]&&a[1]<=b[3];
const inside=([lat,lon],b)=>lon>=b[0]&&lon<=b[2]&&lat>=b[1]&&lat<=b[3];
export function renderRegionMap(config,geo,view,{aliases}={}){
  const insetIds=new Set((config.insets||[]).flatMap(f=>f.ids));
  const frames=[{ids:config.units.map(u=>u.id).filter(id=>!insetIds.has(id)),bounds:config.bounds,extent:config.insets?[10,65,980,440]:[12,38,976,610]},...(config.insets||[])].map(f=>({...f,project:projector(f.bounds,f.extent)}));
  const active=new Set(view.units.filter(u=>u.active).map(u=>u.id)),parts=[];
  parts.push('<defs>'+frames.map((f,i)=>{
    const [x,y]=f.project([f.bounds[3],f.bounds[0]]),[right,bottom]=f.project([f.bounds[1],f.bounds[2]]);
    // Geography keeps its geographic crop. Only overseas connectors use the
    // full-width clip so they reach the edge dots without revealing extra land.
    return `<clipPath id="frame${i}"><rect x="${x}" y="${y}" width="${right-x}" height="${bottom-y}"/></clipPath>`+
      `<clipPath id="edge-frame${i}"><rect x="${f.extent[0]}" y="${y}" width="${f.extent[2]}" height="${bottom-y}"/></clipPath>`;
  }).join('')+'</defs>');
  const represented=new Set();
  for(const unit of config.units){
    const f=geo.features.find(f=>f.id===unit.id),frame=frames.find(f=>f.ids.includes(unit.id));
    if(!frame)throw new Error('地图单元无绘制窗口：'+unit.id);
    const isActive=active.has(unit.id),id=frames.indexOf(frame);
    // Normalize Alaska's islands before projection, clipping and point sampling.
    const polys=f?polygons(f).map(p=>unit.id==='US-AK'?p.map(r=>r.map(([lon,lat])=>[lon>0?lon-360:lon,lat])):p).filter(p=>intersects(boundsFor(p),frame.bounds)):[];
    if(polys.length){
      represented.add(unit.id);
      const path=polys.map(p=>p.map(r=>r.map(([lon,lat],i)=>{if(unit.id==='US-AK'&&lon>0)lon-=360;const [x,y]=frame.project([lat,lon]);return `${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`;}).join('')+'Z').join('')).join('');
      parts.push(`<path class="prefecture${isActive?' visited':''}" data-unit="${unit.id}" clip-path="url(#frame${id})" d="${path}" fill-rule="evenodd"><title>${escapeHtml(unit.name)}</title></path>`);
      const scaleX=Math.abs(frame.project([frame.bounds[1],frame.bounds[0]+1])[0]-frame.project([frame.bounds[1],frame.bounds[0]])[0]);
      let dots=0;const step=id?Math.max(config.step,5/scaleX):config.step;
      for(const p of polys){const b=boundsFor(p);const [w,s,e,n]=[Math.max(b[0],frame.bounds[0]),Math.max(b[1],frame.bounds[1]),Math.min(b[2],frame.bounds[2]),Math.min(b[3],frame.bounds[3])];
        for(let lon=Math.ceil(w/step)*step;lon<=e;lon+=step)for(let lat=Math.ceil(s/step)*step;lat<=n;lat+=step){if(!pointInRing([lon,lat],p[0])||p.slice(1).some(r=>pointInRing([lon,lat],r)))continue;const [x,y]=frame.project([lat,lon]);dots++;parts.push(`<circle class="jp-dot${isActive?' visited':''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.3"/>`);}
      }
      if(isActive&&!dots){const anchor=unit.anchor||[polys[0][0][0][1],polys[0][0][0][0]];const [x,y]=frame.project(anchor);parts.push(`<circle class="jp-dot visited" cx="${x}" cy="${y}" r="2.4"/>`);}
    }else if(unit.anchor){represented.add(unit.id);const [x,y]=frame.project(unit.anchor);parts.push(`<circle data-unit="${unit.id}" class="prefecture${isActive?' visited':''} micro-unit" cx="${x}" cy="${y}" r="3"><title>${escapeHtml(unit.name)}</title></circle>`);}
  }
  const missing=view.units.filter(u=>u.active&&!represented.has(u.id));if(missing.length)throw new Error('已激活地区缺少可见地图单元：'+missing.map(u=>u.name).join('、'));
  const main=frames[0];
  // Put overseas connectors behind the local network so they never visually
  // overpower the route the reader is meant to follow inside the region.
  if(config.edgeLabels){
    // Keep the side rail close to the poster edge. The older 104px rail left
    // overseas nodes inside the map's visual field, where they could collide
    // with domestic labels and route hubs. Regional pages share one tighter
    // rail; Japan's bespoke inset layout remains unchanged.
    const edge=renderEdgeLabels({
      routes:(view.border||[]).filter(isRecordedMovement),regionCountries:config.countries,bounds:main.bounds,
      project:main.project,extent:main.extent,aliases,gap:config.edgeLabels.gap||30,
      rail:config.edgeLabels.rail??52,labelPadding:config.edgeLabels.labelPadding??34,
      verticalPadding:config.edgeLabels.verticalPadding??72,
      bottomPadding:config.edgeLabels.bottomPadding??(config.insets?36:12),clipId:'edge-frame0',
    });
    parts.push(edge.svg);
  }
  for(const leg of routeSegments(view.routes)){
    const frame=frames.find(f=>inside(leg.a,f.bounds)&&inside(leg.b,f.bounds));if(!frame)continue;
    parts.push(`<path class="jp-route${leg.mode==='飞机'?' air':''}${leg.structuralLink?' structural':''}" data-route="true" data-type="${leg.structuralLink?'structural':'movement'}" data-structural="${leg.structuralLink}" data-count="${leg.count}" clip-path="url(#frame${frames.indexOf(frame)})" d="${arcPath(frame.project(leg.a),frame.project(leg.b),leg.mode)}"/>`);
  }
  const visible=view.places.filter(p=>p.active&&p.lat!==null&&p.lon!==null);
  for(const p of visible){const frame=frames.find(f=>inside([p.lat,p.lon],f.bounds));if(!frame)continue;const [x,y]=frame.project([p.lat,p.lon]);parts.push(`<circle class="jp-place" cx="${x}" cy="${y}" r="2.9"><title>${escapeHtml(p.name)}</title></circle>`);}
  const labelView={scope:{id:config.id||config.name},places:visible,routes:view.routes.filter(isRecordedMovement).map(r=>({...r,nodes:r.nodes||(r.displayPoints||r.points||[]).map((_,i)=>({id:r.nodeRefs?.[i]?.placeId||r.nodeRefs?.[i]?.id,name:(r.displayNames||r.names||[])[i]||r.nodeRefs?.[i]?.name}))}))};
  const labels=placeLabels(labelView,frames,(all,p)=>all.find(f=>inside([p.lat,p.lon],f.bounds))||main);
  for(const label of labels){const [x,y]=[label.nodeX,label.nodeY];parts.push(`<path class="jp-leader" d="M${x},${y}L${label.x+(label.anchor==='end'?4:-4)},${label.y-5}"/><text class="jp-label" data-place-label="${escapeHtml(label.id)}" x="${label.x}" y="${label.y}" text-anchor="${label.anchor}">${escapeHtml(label.name)}</text>`);}
  for(const f of frames.slice(1)){parts.push(`<text class="jp-inset-title" x="${f.extent[0]}" y="${f.extent[1]-10}">${f.label}</text>`);}
  parts.push(`<text class="map-source" x="990" y="678" text-anchor="end">地图：${escapeHtml(config.source)}</text>`);
  return {svg:`<svg viewBox="0 0 1000 690" role="img" aria-label="${config.name}地区旅行地图，青绿色为纳入的地域，红点为旅行地点">${parts.join('')}</svg>`,represented:[...represented],active:active.size};
}
