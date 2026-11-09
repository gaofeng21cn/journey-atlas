// Simplify only the display projection. The original public boundaries and
// point-in-polygon decisions continue to use the unsimplified geometry.
function segmentDistanceSquared(p,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],len=dx*dx+dy*dy;
  const t=len?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/len)):0;
  return (p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dy)**2;
}
export function simplifyRing(ring,tolerance=.006){
  if(ring.length<6)return ring.map(p=>p.map(x=>+x.toFixed(4)));
  const keep=new Set([0,ring.length-1]),stack=[[0,ring.length-1]];
  while(stack.length){const [a,b]=stack.pop();let far=tolerance*tolerance,index=-1;
    for(let i=a+1;i<b;i++){const d=segmentDistanceSquared(ring[i],ring[a],ring[b]);if(d>far){far=d;index=i;}}
    if(index!==-1){keep.add(index);stack.push([a,index],[index,b]);}
  }
  const simplified=[...keep].sort((a,b)=>a-b).map(i=>ring[i].map(x=>+x.toFixed(4)));
  return simplified.length>=4?simplified:ring.map(p=>p.map(x=>+x.toFixed(4)));
}
export function displayGeometry(geo){return {type:'FeatureCollection',features:geo.features.map(f=>{
  const points=f.geometry.type==='Polygon'?f.geometry.coordinates.flat():f.geometry.coordinates.flat(2),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  const tolerance=Math.min(.006,Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys))/160);
  return {type:'Feature',id:f.id,geometry:{type:f.geometry.type,coordinates:f.geometry.type==='Polygon'?f.geometry.coordinates.map(r=>simplifyRing(r,tolerance)):
    f.geometry.coordinates.map(p=>p.map(r=>simplifyRing(r,tolerance)))}};
})};}
