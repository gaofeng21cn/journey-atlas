import {greatCircleKm} from './travel-layers.mjs';
import {routeSegments} from './route-geometry.mjs';

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mercator=([lat,lon])=>[lon*Math.PI/180,-Math.log(Math.tan(Math.PI/4+Math.max(-80,Math.min(80,lat))*Math.PI/360))];

export function annualMap(view,dots,{labels=[]}={}){
  const width=1032,height=534,padding=46;
  const positions=view.places.map(p=>[p.lat,p.lon]);
  if(!positions.length)throw new Error('年度地图没有地面到访地点');
  const west=Math.min(...positions.map(p=>p[1]))-17,east=Math.max(...positions.map(p=>p[1]))+18;
  const south=Math.max(-65,Math.min(...positions.map(p=>p[0]))-12),north=Math.min(75,Math.max(...positions.map(p=>p[0]))+12);
  const [minX,minY]=mercator([north,west]),[maxX,maxY]=mercator([south,east]);
  const scale=Math.min((width-2*padding)/(maxX-minX),(height-2*padding)/(maxY-minY));
  const offsetX=(width-(maxX-minX)*scale)/2,offsetY=(height-(maxY-minY)*scale)/2;
  const project=p=>{const [x,y]=mercator(p);return [offsetX+(x-minX)*scale,offsetY+(y-minY)*scale];};
  const active=new Set(view.countries),newCountries=new Set(view.newCountries);
  const land=dots.filter(([lon,lat])=>lon>=west&&lon<=east&&lat>=south&&lat<=north).map(([lon,lat,country])=>{
    const [x,y]=project([lat,lon]);return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.58" class="land-dot${active.has(country)?' visited':''}${newCountries.has(country)?' newly-visited':''}"/>`;
  }).join('');
  const segments=routeSegments(view.routes).filter(s=>!s.structuralLink&&(s.mode==='飞机'||greatCircleKm(s.a,s.b)>=85));
  const nodes=new Map(),paths=[];
  for(const s of segments){
    const a=project(s.a),b=project(s.b),dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(len<1)continue;
    const flight=s.mode==='飞机',bow=Math.min(len*(flight?.115:.045),flight?88:22);
    const cx=(a[0]+b[0])/2-dy/len*bow*2,cy=(a[1]+b[1])/2+dx/len*bow*2;
    paths.push(`<path class="route ${flight?'flight':'ground'}" d="M${a[0]},${a[1]}Q${cx},${cy} ${b[0]},${b[1]}" data-from="${s.a.join(',')}" data-to="${s.b.join(',')}"/>`);
    for(const p of [s.a,s.b])nodes.set(p.map(v=>v.toFixed(3)).join(','),p);
  }
  const marks=[...nodes.values()].map(p=>{const [x,y]=project(p);return `<circle class="route-end" cx="${x}" cy="${y}" r="2.5"/>`;}).join('');
  const newNodes=[];
  for(const city of view.newCities){
    const p=project([city.lat,city.lon]);
    if(newNodes.some(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<9))continue;
    if(labels.some(l=>l.accent&&view.places.find(q=>q.id===l.placeId&&city.placeIds.includes(q.id))))continue;
    newNodes.push(p);
  }
  const firstMarks=newNodes.map(([x,y])=>`<circle class="first-visit" cx="${x}" cy="${y}" r="4.1"/>`).join('');
  const named=labels.map(spec=>{
    const p=view.places.find(p=>p.id===spec.placeId);if(!p)return '';
    const [x,y]=project([p.lat,p.lon]),dx=spec.dx||0,dy=spec.dy||0,anchor=dx<0?'end':'start';
    return `<g class="map-label${spec.accent?' accent':''}" data-place="${esc(p.id)}"><circle cx="${x}" cy="${y}" r="${spec.accent?6:4}"/>${spec.accent?`<circle class="new-ring" cx="${x}" cy="${y}" r="10"/>`:''}<path class="leader" d="M${x},${y}L${x+dx*.7},${y+dy}H${x+dx}"/><text x="${x+dx+(dx<0?-5:5)}" y="${y+dy-5}" text-anchor="${anchor}">${esc(spec.name||p.name)}</text>${spec.caption?`<text class="caption" x="${x+dx+(dx<0?-5:5)}" y="${y+dy+16}" text-anchor="${anchor}">${esc(spec.caption)}</text>`:''}</g>`;
  }).join('');
  return {svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${view.year}年度旅行地图"><defs><clipPath id="annual-map-clip"><rect width="${width}" height="${height}"/></clipPath></defs><g clip-path="url(#annual-map-clip)">${land}<g class="routes">${paths.join('')}</g><g>${marks}${firstMarks}</g><g>${named}</g></g></svg>`,segments:segments.length,nodes:nodes.size,bounds:[west,south,east,north]};
}
