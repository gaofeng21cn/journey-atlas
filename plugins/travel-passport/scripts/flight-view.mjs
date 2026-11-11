// Pure projection of the maintained atlas. No personal file or legacy snapshot
// is read here; airport contact never creates a country/city visit.
import { validateFlightCardData } from './flight-card-data.mjs';
import { allocateMeters, greatCircleKm } from './travel-layers.mjs';
import { transportNodeId } from './node-access.mjs';

const planned=route=>{
  const conclusion=route.review?.conclusion||route.evidenceReview?.conclusion;
  return conclusion?conclusion==='计划':['计划','planned','计划航班','计划航段'].includes(route.status);
};
const activeFlight=route=>route.mode==='飞机'&&route.include!==false&&!route.candidate&&!route.structuralLink&&
  !['资料间隔','区域接续'].includes(route.recordType);
const splitTotal=(value,weights,{metres=false}={})=>{
  if(!Number.isFinite(value)||value<0)throw new Error('飞行统计值须为非负有限数');
  if(!value)return weights.map(()=>0);
  if(metres)return allocateMeters(value*1000,weights).map(n=>n/1000);
  const sum=weights.reduce((s,n)=>s+n,0),out=weights.map(n=>sum?value*n/sum:value/weights.length);
  // The last segment owns any floating remainder, preserving the supplied
  // route duration rather than inventing a second time model.
  out[out.length-1]=value-out.slice(0,-1).reduce((s,n)=>s+n,0);
  return out;
};

export function flightView(atlas){
  if(!Array.isArray(atlas?.routes)||!Array.isArray(atlas?.countries)||!Array.isArray(atlas?.locationLayer?.places))throw new Error('飞行投影需要完整 atlas 路线、独立国家覆盖与地点层');
  const routes=atlas.routes.filter(activeFlight),flights=[],arcs=[],airports=new Map(),airlines=new Set();
  for(const route of routes){
    if(!Array.isArray(route.points)||route.points.length<2||route.names?.length!==route.points.length)throw new Error('飞行路线缺原始端点：'+route.id);
    const weights=route.points.slice(1).map((point,i)=>greatCircleKm(route.points[i],point));
    const kms=splitTotal(route.countDistance===false?0:route.km??0,weights,{metres:true});
    const suppliedMinutes=route.travelMinutes??route.minutes;
    const minutes=splitTotal(route.countDuration===false?0:suppliedMinutes??0,weights);
    const airline=route.airline||route.airlineName||'';if(airline)airlines.add(airline);
    for(let i=1;i<route.points.length;i++){
      const from=route.names[i-1],to=route.names[i],id=route.points.length===2?route.id:route.id+'/'+i;
      const kind=planned(route)?'planned':['已飞','已使用','used','本人确认'].includes(route.status)?'used':'inferred';
      const year=Number(String(route.startDate||route.date||'').match(/\d{4}/)?.[0]);
      if(!Number.isFinite(year))throw new Error('飞行路线缺年份：'+route.id);
      flights.push({id,transportId:route.id,segment:i,from,to,date:route.date,
        startDate:route.startDate||route.date,endDate:route.endDate||route.date,timePrecision:route.timePrecision||'',
        kind,y:year,km:kms[i-1],durationMinutes:minutes[i-1],airline});
      arcs.push({id,from,to,km:kms[i-1],a:[...route.points[i-1]],b:[...route.points[i]]});
      for(const index of [i-1,i]){
        const point=route.points[index],name=route.names[index];
        const country=route.countries?.length===route.points.length?route.countries[index]:route.countries?.[0]||'';
        const nodeId=route.nodeIds?.[index]||route.nodeRefs?.[index]?.id||transportNodeId(name,point,country),old=airports.get(nodeId);
        if(old&&greatCircleKm([old.lat,old.lon],point)>0.05)throw new Error('同一机场节点编号坐标冲突：'+nodeId);
        airports.set(nodeId,{id:nodeId,name:old?.name||name,lat:point[0],lon:point[1],country,n:(old?.n||0)+1});
      }
    }
  }
  if(!flights.length)throw new Error('没有已纳入的实际飞行航段');
  const countries=[...new Map(atlas.countries.map(({name,flag})=>[name,{name,flag:flag||''}])).values()];
  const covered=new Set(countries.map(c=>c.name)),placeIndex=new Map();
  for(const place of atlas.locationLayer.places){
    if(place.include===false||!covered.has(place.country)||!['已到访','计划'].includes(place.status)||['交通节点','行政区'].includes(place.level))continue;
    const id=place.id||place.country+'|'+place.name;
    placeIndex.set(id,{id,country:place.country,city:place.name});
  }
  const total=key=>flights.reduce((sum,flight)=>sum+flight[key],0),years=flights.map(f=>f.y);
  const plannedCount=flights.filter(f=>f.kind==='planned').length;
  return validateFlightCardData({
    meta:{source:'atlas',flightCount:flights.length-plannedCount,plannedCount,totalKm:total('km'),totalMinutes:total('durationMinutes'),
      firstYear:Math.min(...years),lastYear:Math.max(...years),airlines:airlines.size,airports:airports.size,
      countries:countries.length,cities:placeIndex.size,earthKm:atlas.meta?.earthKm||40075,
      missingKm:routes.filter(r=>r.countDistance!==false&&r.km==null).length,
      missingMinutes:routes.filter(r=>r.countDuration!==false&&(r.travelMinutes??r.minutes)==null).length},
    countries,cityList:[...placeIndex.values()],airportPoints:[...airports.values()].sort((a,b)=>b.n-a.n||a.id.localeCompare(b.id)),arcs,flights,
  });
}
