// Read-only screening. A time/airport match is a review signal, never a visit
// decision. Photos, activity content and the source narrative resolve it.
import {greatCircleKm} from './travel-layers.mjs';
import {validatePlaceEvidence} from './evidence-contract.mjs';

const formatters=new Map();
export function localInstant(date,time,timeZone){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!/^\d{2}:\d{2}$/.test(time||'')||!timeZone)return null;
  const target=Date.parse(`${date}T${time}:00Z`);
  if(!formatters.has(timeZone))formatters.set(timeZone,new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}));
  let instant=target;
  for(let i=0;i<3;i++){
    const parts=formatters.get(timeZone).formatToParts(new Date(instant)),v=k=>parts.find(p=>p.type===k).value;
    const wall=Date.parse(`${v('year')}-${v('month')}-${v('day')}T${v('hour')}:${v('minute')}:${v('second')}Z`);
    const delta=target-wall;instant+=delta;if(!delta)break;
  }
  return instant;
}

export function flightWindows(rows){
  return rows.flatMap(r=>{
    if(r['原始客票状态']!=='已使用')return [];
    const date=r['日期标准'],start=localInstant(date,r['出发时间'],r['出发时区']);
    const arrivalDate=String(r['到达日期推算']||'').match(/^\d{4}-\d{2}-\d{2}/)?.[0]||date;
    let end=localInstant(arrivalDate,r['到达时间'],r['到达时区']);
    if(start===null||end===null)return [];
    if(end<=start)end+=86400000;
    if(end-start>24*3600000)return [];
    return [{id:r['证据编号'],date,start,end,from:r['出发城市'],to:r['到达城市'],
      points:[[+r['纬度_出发'],+r['经度_出发']],[+r['纬度_到达'],+r['经度_到达']]]}];
  });
}

const normalize=s=>String(s||'').trim().toLowerCase().replace(/[\s·・•()（）-]/g,'').replace(/(?:特别行政区|特别市|广域市|自治州|自治县|市|县)$/,'');
export function placePhotos(place,photos){
  const names=new Set([place.name,...(place.originalNames||[])].map(normalize).filter(Boolean));
  return photos.filter(p=>p.gps_valid&&p.country_code===place.countryCode&&
    (p.city?[p.city]:(p.places||[])).some(n=>names.has(normalize(n))));
}

export function promotionDecision(candidate){
  if((candidate['核定结论']||candidate['核定状态'])!=='地面到访')return {ok:false,reason:'尚未明确核定地面到访；GPS或已使用客票只证明位置/交通接触'};
  if(!candidate['证据']||!candidate['关联正文'])return {ok:false,reason:'地面核定须保留证据与正文'};
  const review=validatePlaceEvidence({...candidate,'到访状态':'已到访'});
  return review.ok?{ok:true,evidence:review.evidence}:{ok:false,reason:review.errors.join('；')};
}

export function screenPhoto(photo,windows){
  const time=Date.parse(photo.time_utc||photo.time_recorded),point=[photo.lat,photo.lon];
  const flights=Number.isFinite(time)?windows.filter(w=>time>w.start&&time<w.end&&
    // A camera clock alone is insufficient, especially across time zones.
    // Retain only geographically plausible observations along that flight.
    greatCircleKm(w.points[0],point)+greatCircleKm(point,w.points[1])<=greatCircleKm(...w.points)+250):[];
  const airportText=[photo.address,...photo.places||[]].join(' ');
  return {uuid:photo.uuid,time:photo.time_recorded,utc:photo.time_utc,city:photo.city,address:photo.address,
    point,preview:photo.preview,flights:flights.map(w=>({id:w.id,from:w.from,to:w.to})),
    airportHint:/机场|Airport|Terminal|航站楼|空港/i.test(airportText)};
}

export function visitEvidenceReport(places,photos,flights){
  const windows=flightWindows(flights);
  return places.map(p=>{
    const observations=placePhotos(p,photos).map(photo=>screenPhoto(photo,windows));
    return {id:p.id,name:p.name,country:p.country,state:p.status,include:p.include,evidence:p.evidence,source:p.source,
      observations,photoCount:observations.length,inFlight:observations.filter(p=>p.flights.length).length,
      airportHints:observations.filter(p=>p.airportHint).length};
  });
}
