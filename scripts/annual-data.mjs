import {dateBounds,greatCircleKm} from './travel-layers.mjs';
import {isRecordedMovement} from '../src/route-semantics.mjs';
import {travelTime} from '../src/transport-time.mjs';

const planned=r=>[r.status,r.occurrenceStatus,r.review?.conclusion].some(s=>['计划','计划航班','待飞'].includes(s));
const startOf=r=>r.startDate||String(r.date||'').match(/\d{4}(?:-\d{2}(?:-\d{2})?)?/)?.[0]||'';
const groundPlace=p=>p.include!==false&&p.status==='已到访'&&!['交通节点','行政区','区域接续'].includes(p.level);
const bounds=(first,last=first)=>{const a=dateBounds(first),b=dateBounds(last);return a&&b?{start:a.start,end:b.end}:null;};

// A year is a projection over the same deduplicated physical-movement ledger.
// Entire movements belong to their departure year; coarse/cross-year records
// retain their source window rather than gaining invented daily mileage.
export function annualView(atlas,{year,asOf=`${year}-12-31`,basePlaceId,placeGroups=[]}={}){
  if(!Number.isInteger(year)||year<1900||year>2200)throw new Error('年度须为1900—2200之间的整数');
  const end=String(asOf),window=bounds(`${year}-01-01`,end);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(end)||!window||end<`${year}-01-01`||end>`${year}-12-31`)throw new Error('截至日期须在所选年度内');
  const routes=atlas.routes.filter(r=>isRecordedMovement(r)&&!planned(r)&&String(startOf(r)).startsWith(String(year))&&dateBounds(startOf(r))?.start<=window.end);
  const index=new Map(atlas.locationLayer.places.map(p=>[p.id,p]));
  const visits=(atlas.visitInstances||[]).filter(v=>v.include!==false&&v.activity==='地面到访'&&groundPlace(index.get(v.placeId)||{}));
  const inYear=visits.filter(v=>{const b=bounds(v.startDate,v.endDate);return b&&b.start<=window.end&&b.end>=window.start;});
  // Older maintained visit tables can omit a later return. A named ground
  // endpoint plus the SAME reviewed travel narrative supplies temporal proof;
  // airport service names, raw GPS proximity and a place's lifetime range do not.
  const supplementalVisits=[];
  for(const r of routes.filter(r=>r.mode!=='飞机'&&r.source))for(const p of atlas.locationLayer.places.filter(groundPlace)){
    const sources=new Set(String(p.source||'').split('；'));
    if(!String(r.source).split('；').some(s=>sources.has(s))||!r.names?.includes(p.name))continue;
    if(inYear.some(v=>v.placeId===p.id&&v.journeyId===r.journeyId))continue;
    const visit={id:'annual:'+r.id+':'+p.id,placeId:p.id,journeyId:r.journeyId,startDate:startOf(r),endDate:r.endDate||startOf(r),source:r.source,
      basis:'同一已核旅行正文中的明确地面路线节点'};
    inYear.push(visit);supplementalVisits.push(visit);
  }
  const ids=new Set(inYear.map(v=>v.placeId));
  const places=[...ids].map(id=>index.get(id));
  const grouping=new Map();
  for(const group of placeGroups){
    if(!group.id||!group.name||!Array.isArray(group.placeIds)||group.placeIds.length<2)throw new Error('城市显示归组须有编号、名称和至少两个正式地点编号');
    const countries=new Set(group.placeIds.map(id=>index.get(id)?.country));
    if(countries.has(undefined)||countries.size!==1)throw new Error('城市显示归组不能引用未知或跨国地点');
    for(const id of group.placeIds){if(grouping.has(id))throw new Error('城市不能重复显示归组');grouping.set(id,group);}
  }
  const firstFor=p=>[p.first,...visits.filter(v=>v.placeId===p.id).map(v=>v.startDate)].filter(Boolean).sort()[0]||'';
  const cityMap=new Map();
  for(const p of places.filter(p=>p.level==='城市/城镇'||!p.level)){
    const g=grouping.get(p.id),id=g?.id||p.id;
    if(!cityMap.has(id))cityMap.set(id,{id,name:g?.name||p.name,country:p.country,placeIds:[],first:firstFor(p),lat:p.lat,lon:p.lon});
    const c=cityMap.get(id);c.placeIds.push(p.id);if(firstFor(p)<c.first)c.first=firstFor(p);
  }
  const cities=[...cityMap.values()];
  const countryFirst=new Map();
  for(const p of atlas.locationLayer.places.filter(groundPlace)){
    const first=firstFor(p);if(first&&(!countryFirst.has(p.country)||first<countryFirst.get(p.country)))countryFirst.set(p.country,first);
  }
  const countries=[...new Set(places.map(p=>p.country))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  const newCountries=countries.filter(c=>countryFirst.get(c)?.startsWith(String(year)));
  const newCities=cities.filter(p=>p.first.startsWith(String(year)));
  const base=index.get(basePlaceId);
  if(!base||!groundPlace(base))throw new Error('年度回顾须指定已有地面到访基地地点编号');
  const farthest=[...cities].map(p=>({...p,from:base.name,km:Math.round(greatCircleKm([base.lat,base.lon],[p.lat,p.lon]))})).sort((a,b)=>b.km-a.km)[0]||null;
  const flightRoutes=routes.filter(r=>r.mode==='飞机');
  const totalMeters=routes.filter(r=>r.countDistance!==false).reduce((s,r)=>s+Math.round((r.km||0)*1000),0);
  const flightMeters=flightRoutes.filter(r=>r.countDistance!==false).reduce((s,r)=>s+Math.round((r.km||0)*1000),0);
  const flightMinutes=flightRoutes.reduce((s,r)=>s+(r.countDuration===false?0:travelTime(r).minutes),0);
  const tripCountries=new Map(),journeys=new Map(atlas.journeyLayer.journeys.map(j=>[j.id,j]));
  for(const v of inYear){
    const p=index.get(v.placeId),j=journeys.get(v.journeyId);if(p.country===base.country||!j)continue;
    if(!tripCountries.has(p.country))tripCountries.set(p.country,new Set());
    tripCountries.get(p.country).add(j.closureGroup||j.source||j.id);
  }
  const revisits=[...tripCountries].map(([country,trips])=>({country,trips:trips.size})).sort((a,b)=>b.trips-a.trips);
  const observedDates=routes.map(r=>r.endDate||startOf(r)).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d<=end).sort();
  return {year,asOf:end,dataThrough:observedDates.at(-1)||end,base:{id:base.id,name:base.name,lat:base.lat,lon:base.lon},supplementalVisits,
    routes,places,cities,countries,newCountries,newCities,farthest,revisits,
    metrics:{totalMeters,totalKm:Math.round(totalMeters/1000),flightKm:flightMeters/1000,groundKm:(totalMeters-flightMeters)/1000,
      flightHours:Math.round(flightMinutes/60),flightCount:flightRoutes.reduce((s,r)=>s+Math.max(1,(r.points?.length||2)-1),0),countries:countries.length,cities:cities.length,newCities:newCities.length,earth:totalMeters/1000/(atlas.meta.earthKm||40075)},
    policy:{distance:'同一有效移动台账，包含步行及日常通勤；不另加城市汇总',year:'移动按开始日期所属年度归属，不按日均摊跨年粗日期',
      coverage:'仅实际地面到访；机场、转机与途经不激活到访',novelty:'与年度以前的正式地面到访比较；归组只影响城市阅读，不改变地点或计程'}};
}
