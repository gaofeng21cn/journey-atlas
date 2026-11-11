import {createReadStream} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {pointInFeature} from './region-map.mjs';
import {greatCircleKm} from './travel-layers.mjs';

const maxTrackGap=900;
const validCoordinates=(lat,lon)=>Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;
function intervalMaxAccuracy(samples,start,end){let maximum=0;for(let i=start;i<=end;i++)maximum=Math.max(maximum,samples[i].accuracy);return maximum;}
function intervalMaxGap(samples,start,end){let maximum=0;for(let i=start+1;i<=end;i++)maximum=Math.max(maximum,samples[i].time-samples[i-1].time);return maximum;}
function simplifyTrackSamples(samples,tolerance=.00018){
  // Keep sample identity as well as shape. Display-only rounding would lose
  // the association with its timestamp and GPS accuracy, especially on stays.
  const keep=new Set([0,samples.length-1]);let anchor=0;
  for(let i=1;i<samples.length;i++){
    if(samples[i].time-samples[anchor].time>maxTrackGap){keep.add(i-1);anchor=i-1;}
    if(samples[i].time-samples[anchor].time>=300){keep.add(i);anchor=i;}
  }
  const stack=[[0,samples.length-1]];
  while(stack.length){const [a,b]=stack.pop(),start=samples[a],end=samples[b],dx=end.lon-start.lon,dy=end.lat-start.lat,len=dx*dx+dy*dy;let far=tolerance*tolerance,index=-1;
    for(let i=a+1;i<b;i++){const p=samples[i],ratio=len?Math.max(0,Math.min(1,((p.lon-start.lon)*dx+(p.lat-start.lat)*dy)/len)):0,d=(p.lon-start.lon-ratio*dx)**2+(p.lat-start.lat-ratio*dy)**2;
      if(d>far){far=d;index=i;}}
    if(index!==-1){keep.add(index);stack.push([a,index],[index,b]);}
  }
  return [...keep].sort((a,b)=>a-b);
}

const dateFormatters=new Map();
export function cityDate(seconds,timeZone='Asia/Tokyo'){
  if(!dateFormatters.has(timeZone))dateFormatters.set(timeZone,new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}));
  const parts=dateFormatters.get(timeZone).formatToParts(new Date(seconds*1000));
  const value=k=>parts.find(p=>p.type===k).value;return `${value('year')}-${value('month')}-${value('day')}`;
}

// Observation coverage is independent of which activities have been written
// up. Keep every continuous segment and photo location; activity windows are a
// query, never a destructive filter on the city's evidence archive.
export function cityEvidenceRecord(evidence,journeys=[],timeZone='Asia/Tokyo'){
  const tracks=evidence.tracks||[],inActivity=date=>journeys.some(j=>date>=j.first&&date<=j.last);
  const photoPoints=(evidence.photos||[]).flatMap(p=>{
    const time=Date.parse(p.time_utc)/1000;
    if(!validCoordinates(p.lat,p.lon)||!Number.isFinite(time)||time<=0)return [];
    return [{uuid:p.uuid,time,date:cityDate(time,timeZone),lat:p.lat,lon:p.lon}];
  });
  const days=new Set([...tracks.map(t=>t.date),...photoPoints.map(p=>p.date)]);
  return {summary:{...evidence.summary,retainedTracks:tracks.length,selectedTracks:tracks.length,
    activityTracks:tracks.filter(t=>inActivity(t.date)).length,curatedTrips:journeys.length,recordedDays:days.size},
    tracks,photoPoints,stays:evidence.stays||[],source:{timeZone}};
}
export async function collectCityEvidence({photosPath,footprintPath,geometry,timeZone='Asia/Tokyo'}){
  return (await collectCitiesEvidence({photosPath,footprintPath,cities:[{id:'single',geometry,timeZone}]})).single;
}
function cityCollector({id,geometry,timeZone}){
  if(!id||!geometry?.features?.length||geometry.features.some(f=>!['Polygon','MultiPolygon'].includes(f.geometry?.type)))throw new Error('城市采集需要有效编号、行政边界与时区');
  new Intl.DateTimeFormat('en-CA',{timeZone});
  const featureBounds=geometry.features.map(f=>{const p=f.geometry.type==='Polygon'?f.geometry.coordinates.flat():f.geometry.coordinates.flat(2);return {f,w:Math.min(...p.map(p=>p[0])),s:Math.min(...p.map(p=>p[1])),e:Math.max(...p.map(p=>p[0])),n:Math.max(...p.map(p=>p[1]))};});
  const inside=(lat,lon)=>featureBounds.some(b=>lon>=b.w&&lon<=b.e&&lat>=b.s&&lat<=b.n&&pointInFeature([lon,lat],b.f));
  return {id,timeZone,inside,photos:[],points:[],within:0,poorAccuracy:0,photoImports:0};
}
// Read each original source once, regardless of the number of requested cities.
// Geometry and timezone are supplied by the catalogue, never city-specific code.
export async function collectCitiesEvidence({photosPath,footprintPath,cities}){
  if(!photosPath&&!footprintPath)throw new Error('至少提供足迹或照片定位来源');
  if(!cities?.length||new Set(cities.map(c=>c.id)).size!==cities.length)throw new Error('城市采集列表为空或编号重复');
  const collectors=cities.map(cityCollector);
  if(photosPath)for(const p of JSON.parse(await readFile(photosPath,'utf8'))){
    if(!p.gps_valid||!validCoordinates(p.lat,p.lon))continue;
    for(const c of collectors)if(c.inside(p.lat,p.lon))c.photos.push(p);
  }
  let total=0,headers;
  if(footprintPath)for await(const line of createInterface({input:createReadStream(footprintPath),crlfDelay:Infinity})){
    if(!headers){headers=line.replace(/^\uFEFF/,'').split(',');if(['latitude','longitude','dataTime','accuracy'].some(k=>!headers.includes(k)))throw new Error('足迹CSV缺少纬度、经度、时间或精度字段');continue;}
    if(!line.trim())continue;
    total++;const values=line.split(','),r=Object.fromEntries(headers.map((h,i)=>[h,values[i]]));
    const numeric=value=>value?.trim()?Number(value):NaN,lat=numeric(r.latitude),lon=numeric(r.longitude),time=numeric(r.dataTime),accuracy=numeric(r.accuracy);
    if(!validCoordinates(lat,lon))continue;
    for(const c of collectors){
      if(!c.inside(lat,lon))continue;c.within++;
      if(!Number.isFinite(accuracy)||accuracy<0||accuracy>100){c.poorAccuracy++;continue;}
      // Imported photo positions are evidence, not continuous GPS sampling.
      if(accuracy===0){c.photoImports++;continue;}
      if(!Number.isFinite(time)||time<=0||!Number.isFinite(new Date(time*1000).getTime()))continue;
      c.points.push({time,lat,lon,accuracy,speed:numeric(r.speed)});
    }
  }
  return Object.fromEntries(collectors.map(c=>[c.id,finishCityEvidence(c,total)]));
}
export function finishCityEvidence({points,photos=[],timeZone='UTC',timeZoneAt,within=points.length,poorAccuracy=0,photoImports=0,maxSpeed=120},total){
  points.sort((a,b)=>a.time-b.time);
  const unique=points.filter((p,i)=>!i||p.time!==points[i-1].time||p.lat!==points[i-1].lat||p.lon!==points[i-1].lon);
  const zone=p=>timeZoneAt?timeZoneAt(p.lat,p.lon):timeZone,date=p=>cityDate(p.time,zone(p)),tracks=[],stays=[];let chain=[],stay=[];
  const finishTrack=()=>{if(chain.length>2){const cumulative=[0];
    for(let i=1;i<chain.length;i++)cumulative.push(cumulative.at(-1)+greatCircleKm([chain[i-1].lat,chain[i-1].lon],[chain[i].lat,chain[i].lon]));
    if(cumulative.at(-1)>.1){const indices=simplifyTrackSamples(chain),first=chain[0],last=chain.at(-1);
      tracks.push({id:`gps:${first.time}:${last.time}:${first.lat}:${first.lon}`,date:date(first),timeZone:zone(first),start:first.time,end:last.time,
        points:indices.map(i=>[chain[i].lon,chain[i].lat]),sampleTimes:indices.map(i=>chain[i].time),sampleAccuracies:indices.map(i=>chain[i].accuracy),
        sampleIntervalMaxAccuracies:indices.map((i,j)=>intervalMaxAccuracy(chain,j?indices[j-1]:i,i)),
        sampleIntervalMaxGaps:indices.map((i,j)=>intervalMaxGap(chain,j?indices[j-1]:i,i)),
        sampleIndices:indices,sampleCumulativeKm:indices.map(i=>cumulative[i]),samples:chain.length});}}chain=[];};
  const finishStay=()=>{if(stay.length>2&&stay.at(-1).time-stay[0].time>=600)stays.push({date:date(stay[0]),start:stay[0].time,end:stay.at(-1).time,lat:stay.reduce((s,p)=>s+p.lat,0)/stay.length,lon:stay.reduce((s,p)=>s+p.lon,0)/stay.length,samples:stay.length});stay=[];};
  for(const p of unique){const previous=chain.at(-1),gap=previous?p.time-previous.time:0,distance=previous?greatCircleKm([p.lat,p.lon],[previous.lat,previous.lon]):0;
    if(previous&&(gap>maxTrackGap||gap<=0||date(previous)!==date(p)||zone(previous)!==zone(p)||distance/Math.max(gap,1)*3600>maxSpeed))finishTrack();
    chain.push(p);const origin=stay[0];if(origin&&(p.time-stay.at(-1).time>900||greatCircleKm([p.lat,p.lon],[origin.lat,origin.lon])>.15))finishStay();stay.push(p);
  }finishTrack();finishStay();
  return {summary:{footprintRows:total,footprintInside:within,usableGps:unique.length,photoImports,poorAccuracy,photos:photos.length,tracks:tracks.length,stays:stays.length},photos,points:unique,tracks,stays};
}

// A registered pair only identifies a movement when a single timed GPS track
// reaches its distinct endpoints in forward order. No synthetic connector is
// appended; endpoint differences remain explicit metadata, never observed km.
export function matchObservedPath(tracks,date,from,to,options={}){
  if(typeof options==='number')options={radius:options};
  if(!Array.isArray(from)||!Array.isArray(to)||from.length!==2||to.length!==2||!validCoordinates(...from)||!validCoordinates(...to))return null;
  const separation=greatCircleKm(from,to);if(separation<=0)return null;
  const radius=options.radius??.12;if(!Number.isFinite(radius)||radius<=0)return null;
  const windowStart=options.windowStart??-Infinity,windowEnd=options.windowEnd??Infinity;
  if((options.windowStart!==undefined&&!Number.isFinite(windowStart))||(options.windowEnd!==undefined&&!Number.isFinite(windowEnd))||windowStart>=windowEnd)return null;
  const boundedWindow=Number.isFinite(windowStart)&&Number.isFinite(windowEnd);let best;
  for(const t of tracks){const points=t.points,times=t.sampleTimes,accuracies=t.sampleAccuracies;
    if(t.date!==date||!Array.isArray(points)||points.length<2||!Array.isArray(times)||times.length!==points.length||!Array.isArray(accuracies)||accuracies.length!==points.length)continue;
    const sourceIndices=t.sampleIndices,intervalGaps=t.sampleIntervalMaxGaps;
    if(sourceIndices!==undefined&&(!Array.isArray(sourceIndices)||sourceIndices.length!==points.length||sourceIndices.some((v,i)=>!Number.isInteger(v)||v<0||(i&&v<=sourceIndices[i-1]))))continue;
    if(intervalGaps!==undefined&&(!Array.isArray(intervalGaps)||intervalGaps.length!==points.length||intervalGaps.some((v,i)=>!Number.isFinite(v)||(i?v<=0||v>maxTrackGap:v!==0))))continue;
    const hasGapProof=Array.isArray(sourceIndices)&&Array.isArray(intervalGaps);
    const timeZone=options.timeZone||t.timeZone||'Asia/Tokyo';let valid=true;const cumulative=[0];
    for(let i=0;i<points.length;i++){const p=points[i],time=times[i],accuracy=accuracies[i];
      if(!Array.isArray(p)||p.length!==2||!validCoordinates(p[1],p[0])||!Number.isFinite(time)||time<=0||!Number.isFinite(new Date(time*1000).getTime())||!Number.isFinite(accuracy)||accuracy<=0||accuracy>100||cityDate(time,timeZone)!==date){valid=false;break;}
      if(i){const gap=time-times[i-1],km=greatCircleKm([points[i-1][1],points[i-1][0]],[p[1],p[0]]),maxGap=hasGapProof?intervalGaps[i]:gap;
        // Simplification can omit continuously recorded samples. Only indexed
        // original interval metadata can prove that a long retained gap is safe.
        if(gap<=0||maxGap>maxTrackGap||(hasGapProof&&(maxGap>gap||maxGap*(sourceIndices[i]-sourceIndices[i-1])<gap-1e-8))||km/gap*3600>120){valid=false;break;}cumulative.push(cumulative.at(-1)+km);}
    }
    if(!valid||(t.start!==undefined&&t.start!==times[0])||(t.end!==undefined&&t.end!==times.at(-1)))continue;
    const sourceKm=t.sampleCumulativeKm,intervalAccuracies=t.sampleIntervalMaxAccuracies;
    if(sourceKm!==undefined&&(!Array.isArray(sourceKm)||sourceKm.length!==points.length||sourceKm.some((v,i)=>!Number.isFinite(v)||v<0||(i&&v<sourceKm[i-1]))))continue;
    if(intervalAccuracies!==undefined&&(!Array.isArray(intervalAccuracies)||intervalAccuracies.length!==points.length||intervalAccuracies.some(v=>!Number.isFinite(v)||v<=0||v>100)))continue;
    if(sourceKm&&sourceKm.some((v,i)=>i&&(v-sourceKm[i-1]<cumulative[i]-cumulative[i-1]-1e-8||(v-sourceKm[i-1])/(times[i]-times[i-1])*3600>120)))continue;
    const starts=[];
    for(let i=0;i<points.length;i++){
      if(times[i]<windowStart||times[i]>windowEnd)continue;
      const p=[points[i][1],points[i][0]],a=greatCircleKm(from,p),b=greatCircleKm(to,p),tolerance=Math.min(.15,separation*.4,radius+Math.min(accuracies[i]/1000,.05));
      if(b<=tolerance&&b<a)for(const start of starts){
        const km=(sourceKm||cumulative)[i]-(sourceKm||cumulative)[start.index];
        // An unbounded same-day match cannot establish a long sightseeing loop
        // as the route between nearby stops. Explicit activity time windows can.
        if(km<=0||(!boundedWindow&&km>Math.max(.3,separation*3+(start.distance+b)*2)))continue;
        const score=start.distance+b+km*.02;
        if(!best||score<best.score)best={score,points:points.slice(start.index,i+1).map(p=>[...p]),trackId:t.id||`gps:${times[0]}:${times.at(-1)}`,
          start:times[start.index],end:times[i],direction:'forward',km,minutes:(times[i]-times[start.index])/60,
          samples:sourceIndices?sourceIndices[i]-sourceIndices[start.index]+1:i-start.index+1,
          accuracy:Math.max(accuracies[start.index],...(intervalAccuracies?intervalAccuracies.slice(start.index+1,i+1):accuracies.slice(start.index+1,i+1))),
          startDistance:start.distance,endDistance:b};
      }
      if(a<=tolerance&&a<b)starts.push({index:i,distance:a});
    }
  }
  if(!best)return null;const {score,...match}=best;return match;
}
