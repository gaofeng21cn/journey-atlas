import {boundsOf} from './scope-model.mjs';

export const geometryPoints=g=>g.type==='Polygon'?g.coordinates.flat():g.type==='MultiPolygon'?g.coordinates.flat(2):g.type==='Point'?[g.coordinates]:g.type==='LineString'?g.coordinates:g.coordinates.flat();
export const unwrapLongitude=(lon,center)=>lon+360*Math.round((center-lon)/360);
export function geometryContains([lat,lon],g,center=lon){
  lon=unwrapLongitude(lon,center);
  const inside=ring=>{let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [rawX,yi]=ring[i],[rawJ,yj]=ring[j],xi=unwrapLongitude(rawX,center),xj=unwrapLongitude(rawJ,center);
    if((yi>lat)!==(yj>lat)&&lon<(xj-xi)*(lat-yi)/(yj-yi)+xi)yes=!yes;
  }return yes;};
  const polys=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
  return polys.some(poly=>inside(poly[0])&&!poly.slice(1).some(inside));
}
export function circularBounds(points,padding=0){
  const lons=[...new Set(points.map(p=>(p[0]+360)%360))].sort((a,b)=>a-b);
  let largest=-1,start=0;
  for(let i=0;i<lons.length;i++){const gap=(i===lons.length-1?lons[0]+360:lons[i+1])-lons[i];if(gap>largest){largest=gap;start=(i+1)%lons.length;}}
  const west=lons[start]>180?lons[start]-360:lons[start],center=west+(360-largest)/2;
  return boundsOf(points.map(([lon,lat])=>[lat,unwrapLongitude(lon,center)]),padding,0);
}
const near=(a,b,pad)=>a[0]<=b[2]+pad&&a[2]>=b[0]-pad&&a[1]<=b[3]+pad&&a[3]>=b[1]-pad;

// Remote territories get independent display frames, not a country-sized
// bounding rectangle spanning oceans. Original geography and facts stay intact.
export function countryDisplay(f,nodes=[]){
  const polys=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
  const entries=polys.map(poly=>{const bounds=circularBounds(poly[0]);return {poly,bounds,area:(bounds[2]-bounds[0])*(bounds[3]-bounds[1])*Math.cos((bounds[1]+bounds[3])*Math.PI/360)};}).sort((a,b)=>b.area-a.area);
  const main=entries[0],center=(main.bounds[0]+main.bounds[2])/2;
  const normalized=entries.map(p=>({...p,poly:p.poly.map(r=>r.map(([lon,lat])=>[unwrapLongitude(lon,center),lat]))}));
  for(const p of normalized)p.bounds=boundsOf(p.poly[0].map(([lon,lat])=>[lat,lon]),0,0);
  const groups=[{members:[normalized[0]],bounds:normalized[0].bounds}];
  for(const p of normalized.slice(1)){
    const pad=Math.max(1.5,(main.bounds[2]-main.bounds[0])*.04),group=groups.find(g=>near(p.bounds,g.bounds,pad));
    if(group){group.members.push(p);group.bounds=boundsOf(group.members.flatMap(p=>p.poly[0]).map(([lon,lat])=>[lat,lon]),0,0);continue;}
    const contacted=nodes.some(n=>{const lon=unwrapLongitude(n.lon,center);return lon>=p.bounds[0]-.1&&lon<=p.bounds[2]+.1&&n.lat>=p.bounds[1]-.1&&n.lat<=p.bounds[3]+.1;});
    if(p.area>=main.area*.012||contacted)groups.push({members:[p],bounds:p.bounds});
  }
  const features=groups.map((g,i)=>({type:'Feature',id:f.id+'#'+i,geometry:{type:'MultiPolygon',coordinates:g.members.map(p=>p.poly)}}));
  const frames=groups.map((g,i)=>({ids:[features[i].id],bounds:boundsOf(g.members.flatMap(p=>p.poly[0]).map(([lon,lat])=>[lat,lon]),.025,0),wrapLongitude:true,
    extent:i?[160+(i-1)*235,488,200,115]:groups.length>1?[145,28,710,420]:[135,32,730,548],label:i?'离岛 / 海外领土':''}));
  return {geometry:{type:'FeatureCollection',features},frames};
}
