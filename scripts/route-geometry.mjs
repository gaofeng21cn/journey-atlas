import { isStructuralRoute, orderedDisplayRoutes } from '../src/route-semantics.mjs';

// Keep direction: an outward and a return leg form two arcs, never one line.
// Repeated identical legs share a stroke while preserving counts in the data.
export function routeSegments(routes){
  const legs=new Map(),recordedPairs=new Set();
  for(const route of orderedDisplayRoutes(routes)){
    const points=route.displayPoints||route.points||[];
    const structuralLink=isStructuralRoute(route);
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i];
      if(a.every((v,j)=>Math.abs(v-b[j])<.0001))continue;
      const pair=[a,b].map(p=>p.map(v=>v.toFixed(3)).join(',')).join('>');
      // A recovered movement takes precedence over an unknown connector with
      // the same direction, even when the connector's transport mode differs.
      if(structuralLink&&recordedPairs.has(pair))continue;
      if(!structuralLink)recordedPairs.add(pair);
      const key=(structuralLink?'structural':route.mode)+'|'+pair;
      const old=legs.get(key);
      legs.set(key,{...(old||route),a,b,structuralLink,
        count:(old?.count||0)+(structuralLink?0:1),
        routeIds:[...new Set([...(old?.routeIds||[]),route.id].filter(Boolean))]});
    }
  }
  return [...legs.values()];
}
export function arcPath(a,b,mode){
  const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
  if(len<6)return `M${a[0]},${a[1]}L${b[0]},${b[1]}`;
  // Ground routes need enough bow to read as movement rather than a rigid
  // straight chord, while staying restrained enough for dense city networks.
  const bow=Math.min(len*(mode==='飞机'?.19:.16),mode==='飞机'?52:46);
  const cx=(a[0]+b[0])/2-dy/len*bow,cy=(a[1]+b[1])/2+dx/len*bow;
  return `M${a[0]},${a[1]}Q${cx},${cy} ${b[0]},${b[1]}`;
}
