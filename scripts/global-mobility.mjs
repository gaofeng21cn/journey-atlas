import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import iso from 'i18n-iso-countries';
import {ROOT,readJson} from './data.mjs';
import {greatCircleKm} from './travel-layers.mjs';
import {pointInFeature} from './region-map.mjs';
import {reconstructCity} from './reconstruct-city.mjs';
import {GLOBAL_EVIDENCE_FILE,locationTimeZone} from './collect-global-evidence.mjs';
import {travelTime} from '../src/transport-time.mjs';
import {sourcePath} from './source-data.mjs';

const distance=(a,b)=>greatCircleKm(a,b);
const dateWithin=(date,route)=>date>=(route.startDate||route.date)&&date<=(route.endDate||route.date);
const degreeBox=feature=>{
  const p=feature.geometry.type==='Polygon'?feature.geometry.coordinates.flat():feature.geometry.coordinates.flat(2);
  return [Math.min(...p.map(p=>p[0])),Math.min(...p.map(p=>p[1])),Math.max(...p.map(p=>p[0])),Math.max(...p.map(p=>p[1]))];
};
const inBox=(p,b)=>p[0]>=b[0]&&p[0]<=b[2]&&p[1]>=b[1]&&p[1]<=b[3];

// Observation clocks and local-date boundaries need not coincide with a ticket's
// departure day. Match the directed archival chain, including transfers, before
// treating a camera interval as a missing long-distance journey.
export function archivalMovementCover(routes,from,to,{date}){
  const day=Date.parse(date),candidates=routes.filter(r=>{
    const start=Date.parse(r.startDate||r.date),end=Date.parse(r.endDate||r.date);
    return r.include!==false&&!r.structuralLink&&r.countDistance!==false&&!['计划','计划航班','待飞','排除'].includes(r.status)&&
      start<=day+86400000&&end>=day-86400000;
  }).flatMap(r=>r.points.slice(1).map((p,i)=>({...r,points:[r.points[i],p],segment:i+1,key:r.id+':'+(i+1)})));
  const start=[from.lat,from.lon],finish=[to.lat,to.lon],queue=[];
  for(const r of candidates){const gap=distance(start,r.points[0]);if(gap<(r.mode==='飞机'?180:30))queue.push({chain:[r],gap});}
  const found=[];
  while(queue.length){
    const {chain,gap}=queue.shift(),last=chain.at(-1),tail=last.points.at(-1),endGap=distance(tail,finish);
    if(endGap<(last.mode==='飞机'?180:30)){found.push({chain,gap:gap+endGap});continue;}
    if(chain.length>=6)continue;
    for(const r of candidates){
      if(chain.some(q=>q.key===r.key)||distance(tail,r.points[0])>.05)continue;
      if(last.id===r.id&&r.segment!==last.segment+1)continue;
      if(Number.isFinite(last.scheduledEnd)&&Number.isFinite(r.scheduledStart)&&r.scheduledStart<last.scheduledEnd)continue;
      queue.push({chain:[...chain,r],gap});
    }
  }
  found.sort((a,b)=>a.gap-b.gap||a.chain.length-b.chain.length);
  return [...new Set(found[0]?.chain.map(r=>r.id)||[])];
}

export function classifyObservationConflicts(reconstruction,references){
  const pending=[],handled=[...(reconstruction.dispositions||[])];
  for(const c of reconstruction.conflicts){
    // Sub-minute sub-kilometre jumps are within the precision/clock failure
    // regime, not evidence of a separate commute that needs an invented road.
    if(c.kind==='impossible-speed'&&c.distanceKm<1&&c.windowMinutes<1){
      handled.push({...c,resolution:'position-clock-noise',reason:'秒级时间窗内的小范围定位跳点不能形成另一段真实移动；保留原始观测与周边已重建行程，不重复计量'});continue;
    }
    const coveredBy=c.from&&c.to&&c.distanceKm>=20?archivalMovementCover(references,
      {lat:c.from[0],lon:c.from[1]},{lat:c.to[0],lon:c.to[1]},c):[];
    if(coveredBy.length){handled.push({...c,resolution:'existing-itinerary',referenceIds:coveredBy,
      reason:'实际日期邻域内已有同向多段行程或机场接续；按档案计程，观测时钟/点位冲突不再当作未重建交通'});continue;}
    pending.push({...c,uncertainFields:c.kind==='impossible-speed'?['观测时间','观测坐标']:['跨区域原始观测身份','未归档交通'],
      nextAction:c.kind==='impossible-speed'?'核对相机时区或原定位精度；不撤回其他已成立的移动':'核对这两项原件是否同期实地拍摄；若成立，按日期窗口和前后驻地重建必要交通'});
  }
  return {...reconstruction,conflicts:pending,dispositions:handled,summary:{...reconstruction.summary,conflicts:pending.length,handledObservations:handled.length}};
}

// A corridor is used only for kilometre ownership. It never merges physical
// nodes, confirms a visit, or changes the registered itinerary geometry.
function corridorPosition(p,a,b){
  const cos=Math.cos((a[0]+b[0])/2*Math.PI/180),x=(b[1]-a[1])*cos,y=b[0]-a[0];
  const px=(p[1]-a[1])*cos,py=p[0]-a[0],fraction=(px*x+py*y)/(x*x+y*y);
  const projected=[a[0]+fraction*y,a[1]+fraction*x/cos];
  return {fraction,lateral:distance(p,projected)};
}

export async function globalNodeResolver(atlas,evidence){
  const [geography,locale,catalog]=await Promise.all([readJson(join(ROOT,'data/geographic-context.json')),readJson(join(ROOT,'node_modules/i18n-iso-countries/langs/zh.json')),readJson(join(ROOT,'data/city-catalog.json'))]);iso.registerLocale(locale);
  // Administrative city boundaries classify extent; mileage never does.
  // A province or Manhattan's derived view is not a new municipal identity.
  const cityAreas=(await Promise.all(catalog.filter(c=>c.detailKind!=='province'&&!c.deriveFrom).map(async c=>{
    try{
      const geo=await readJson(join(ROOT,'data',c.boundaryFile));
      return {...c,features:geo.features.map(f=>({f,b:degreeBox(f)}))};
    }catch(error){if(error.code==='ENOENT')return null;throw error;}
  }))).filter(Boolean);
  const special={HK:'中国香港',MO:'中国澳门',TW:'中国台湾',KR:'韩国',KP:'朝鲜',VA:'梵蒂冈'},countryOf=f=>special[f.properties.code]||iso.getName(f.properties.code,'zh')||f.properties.name;
  const countries=geography.layers.countries.features.map(f=>({f,b:degreeBox(f),name:countryOf(f)})),cells=new Map();
  const cell=(lat,lon)=>Math.floor(lat*20)+','+Math.floor(lon*20);
  for(const p of evidence.photoPoints||[]){if(!p.city||p.sourceKind==='google')continue;const key=cell(p.lat,p.lon);if(!cells.has(key))cells.set(key,[]);cells.get(key).push(p);}
  const locations=atlas.locationLayer.places.filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&p.status==='已到访'&&p.include);
  return point=>{
    const [lon,lat]=point,near=locations.map(p=>({p,d:distance([lat,lon],[p.lat,p.lon])})).sort((a,b)=>a.d-b.d)[0];
    const nearby=[];for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)for(const p of cells.get((Math.floor(lat*20)+y)+','+(Math.floor(lon*20)+x))||[])nearby.push({p,d:distance([lat,lon],[p.lat,p.lon])});
    nearby.sort((a,b)=>a.d-b.d);const photo=nearby[0]?.d<3?nearby[0].p:null;
    const country=countries.find(c=>inBox(point,c.b)&&pointInFeature(point,c.f))?.name||photo?.country|| (near?.d<20?near.p.country:'');
    const city=cityAreas.find(c=>c.country===country&&c.features.some(({f,b})=>inBox(point,b)&&pointInFeature(point,f)));
    const cityName=city?.name||photo?.city;
    const cityKey=cityName?country+'|'+cityName.replace(/市$/,''):'';
    const name=near?.d<1?near.p.name:photo?.city?photo.city.replace(/市$/,''):near?.d<20?near.p.name+'周边':country+'·位置记录';
    return {name,country,cityKey,unitId:city?.unitId||(near?.d<20&&near.p.country===country?(near.p.prefectureId?'JP-'+near.p.prefectureId:near.p.unitId)||'':''),timeZone:locationTimeZone(lat,lon)};
  };
}

// Match an actual forward subsequence, once per source segment. A date/country
// match alone is insufficient: it would erase a whole week of local movement.
export function reconcileMobility(referenceRoutes,reconstruction){
  const nodes=new Map(reconstruction.nodes.map(n=>[n.id,n])),used=new Set(),claimedLegs=new Set(),ownership=[],replacements=new Map(),partialMetrics=new Map();
  const chains=new Map();for(const m of reconstruction.moves){if(!chains.has(m.tripId))chains.set(m.tripId,[]);chains.get(m.tripId).push(m);}
  for(const chain of chains.values())chain.sort((a,b)=>a.start-b.start);
  const partialClaims=new Map();
  const assignPartialIntervals=()=>{
    const eligible=references.filter(r=>r.mode!=='飞机'&&r.startDate&&r.endDate&&Date.parse(r.endDate)-Date.parse(r.startDate)<=2*86400000);
    for(const m of [...reconstruction.moves].sort((a,b)=>a.start-b.start)){
      if(used.has(m.id)||m.km<10)continue;
      const from=nodes.get(m.fromNodeId),to=nodes.get(m.toNodeId);let best;
      for(const r of eligible){
        if(!dateWithin(m.date,r))continue;
        for(let s=1;s<r.points.length;s++){
          const key=r.id+'|'+s;if(claimedLegs.has(key))continue;
          const a=r.points[s-1],b=r.points[s],length=distance(a,b);if(length<50)continue;
          const first=corridorPosition([from.lat,from.lon],a,b),last=corridorPosition([to.lat,to.lon],a,b),advance=(last.fraction-first.fraction)*length;
          const width=Math.min(60,Math.max(5,length*.16));
          const overlap=Math.min(1,last.fraction)-Math.max(0,first.fraction);
          if(overlap<=0||overlap*length<10||first.fraction<-.6||last.fraction>1.6||advance<10||first.lateral>width||last.lateral>width||m.km>advance*2.2)continue;
          const claims=partialClaims.get(key)||[],previous=claims.at(-1);
          // One source leg cannot absorb an unrelated second traversal. All
          // snippets must advance in order within the same observed occurrence.
          if(previous&&(m.start<previous.end||m.start-previous.end>4*3600||first.fraction<previous.fraction-.03))continue;
          const sample=m.path.filter((_,i,p)=>i===p.length-1||i%Math.max(1,Math.ceil(p.length/24))===0);
          const inCorridor=sample.filter(p=>{const q=corridorPosition([p[1],p[0]],a,b);return q.lateral<=width;}).length;
          if(inCorridor<sample.length*.8)continue;
          const score=first.lateral+last.lateral+Math.abs(m.km-advance)*.01;
          if(!best||score<best.score)best={r,s,key,score,first,last};
        }
      }
      if(!best)continue;
      const overlap=Math.min(1,best.last.fraction)-Math.max(0,best.first.fraction),ratio=Math.min(1,overlap/(best.last.fraction-best.first.fraction));
      used.add(m.id);const claims=partialClaims.get(best.key)||[];claims.push({end:m.end,fraction:best.last.fraction});partialClaims.set(best.key,claims);
      if(ratio<.999)partialMetrics.set(m.id,{km:+(m.km*(1-ratio)).toFixed(3),travelMinutes:+(m.travelMinutes*(1-ratio)).toFixed(3),coveredFraction:ratio});
      // Several observations own different portions of one archived leg. The
      // leg's kilometres appear once; partial observations cannot replace it.
      const weights=best.r.points.slice(1).map((p,i)=>distance(best.r.points[i],p)),sum=weights.reduce((s,n)=>s+n,0);
      const portion=overlap;
      ownership.push({referenceId:best.r.id,segment:best.s,moveIds:[m.id],originalKm:best.r.km*weights[best.s-1]/sum*portion,recoveredKm:m.km,
        action:'reference-partial-owns',reason:'短日期窗口内同向沿既有长途路线推进；定位片段只覆盖部分行程，沿线位置与前后时间接续匹配，不重复累计原全程',
        coverageFraction:[+best.first.fraction.toFixed(4),+best.last.fraction.toFixed(4)],coveredKm:+(m.km*ratio).toFixed(3),additionalKm:partialMetrics.get(m.id)?.km||0});
    }
  };
  // Sparse photos can skip known intermediate stops. Link that observation
  // interval to the registered itinerary, instead of adding an imagined
  // shortcut on top of its road-trip or railway kilometres.
  const assignSparseIntervals=()=>{for(const m of reconstruction.moves.filter(m=>m.sourceKind==='gap'&&m.km>=30&&!used.has(m.id))){
    const a=nodes.get(m.fromNodeId),b=nodes.get(m.toNodeId);let best;
    for(const r of referenceRoutes.filter(r=>r.mode!=='飞机'&&!r.structuralLink&&r.countDistance!==false&&r.include!==false&&dateWithin(m.date,r))){
      for(let i=0;i<r.points.length-1;i++)for(let j=i+1;j<r.points.length;j++){
        if(Array.from({length:j-i},(_,s)=>r.id+'|'+(i+s+1)).some(k=>claimedLegs.has(k)))continue;
        const first=distance([a.lat,a.lon],r.points[i]),last=distance([b.lat,b.lon],r.points[j]),separation=distance(r.points[i],r.points[j]);
        const radius=Math.min(30,Math.max(1,separation*.1));if(first>radius||last>radius||separation<20)continue;
        const score=first+last;if(!best||score<best.score)best={r,i,j,score};
      }
    }
    if(best){used.add(m.id);for(let s=best.i+1;s<=best.j;s++)claimedLegs.add(best.r.id+'|'+s);
      const weights=best.r.points.slice(1).map((p,i)=>distance(best.r.points[i],p)),sum=weights.reduce((s,n)=>s+n,0),portion=weights.slice(best.i,best.j).reduce((s,n)=>s+n,0);
      ownership.push({referenceId:best.r.id,segment:best.i+1,endSegment:best.j,moveIds:[m.id],originalKm:sum?best.r.km*portion/sum:best.r.km,recoveredKm:m.km,action:'reference-itinerary-owns',
      reason:'照片间隔两端落在同一已登记行程的正向节点子序列；中途顺序以行程为准，不额外增加捷径里程'});}
  }};
  const references=referenceRoutes.filter(r=>r.countDistance!==false&&!r.structuralLink&&r.include!==false).sort((a,b)=>Number(b.mode==='飞机')-Number(a.mode==='飞机'));
  for(const r of references){
    const points=r.points||[],weights=points.slice(1).map((p,i)=>distance(points[i],p)),total=weights.reduce((s,n)=>s+n,0);
    for(let segment=1;segment<points.length;segment++){
      if(claimedLegs.has(r.id+'|'+segment))continue;
      const a=points[segment-1],b=points[segment],separation=weights[segment-1];if(separation<.15)continue;
      const radius=r.mode==='飞机'?35:separation>=30?Math.min(30,Math.max(3,separation*.1)):Math.min(3,Math.max(.25,separation*.02));let best;
      for(const chain of chains.values()){
        if(!dateWithin(chain[0].date,r))continue;
        for(let i=0;i<chain.length;i++){
          const first=chain[i],from=nodes.get(first.fromNodeId);if(used.has(first.id)||distance(a,[from.lat,from.lon])>radius)continue;
          let cumulative=0,previous=null;
          for(let j=i;j<Math.min(chain.length,i+80);j++){
            const m=chain[j];if(used.has(m.id)||previous&&previous.toVisitId!==m.fromVisitId)break;
            cumulative+=m.km;const to=nodes.get(m.toNodeId),endDistance=distance(b,[to.lat,to.lon]);
            if(cumulative>Math.max(separation*2.5,separation+2))break;
            if(endDistance<=radius&&cumulative>=separation*.7){
              const candidate=chain.slice(i,j+1),score=distance(a,[from.lat,from.lon])+endDistance+Math.abs(cumulative-separation)*.01-(candidate.every(m=>m.sourceKind==='gps')?5:0);
              if(!best||score<best.score)best={score,moves:candidate,km:cumulative,minutes:candidate.reduce((s,m)=>s+m.travelMinutes,0)};
              break;
            }
            previous=m;
          }
        }
      }
      if(!best)continue;
      const archived=r.distanceType==='archived',allGps=best.moves.every(m=>m.sourceKind==='gps');
      // A complete observed chain can refine a model/reference source. Actual
      // archived kilometres keep ownership; their observations only add detail.
      const replace=r.mode!=='飞机'&&!archived&&allGps,originalKm=total?r.km*separation/total:r.km/(points.length-1);
      ownership.push({referenceId:r.id,segment,moveIds:best.moves.map(m=>m.id),originalKm,recoveredKm:best.km,action:replace?'refine-reference':'reference-owns',reason:'同一日期窗口、正向端点和连续访问实例匹配；只消费一次'});
      best.moves.forEach(m=>used.add(m.id));
      claimedLegs.add(r.id+'|'+segment);
      if(replace){const old=replacements.get(r.id)||{kmDelta:0,minutesDelta:0,segments:[]};old.kmDelta+=best.km-originalKm;
        const originalMinutes=(travelTime(r).minutes??0)*(total?separation/total:1/(points.length-1));old.minutesDelta+=best.minutes-originalMinutes;old.segments.push(segment);replacements.set(r.id,old);}
    }
  }
  assignSparseIntervals();
  assignPartialIntervals();
  const reference=referenceRoutes.map(r=>{
    const replacement=replacements.get(r.id);return replacement?{...r,sourceKm:r.km,sourceTravelMinutes:r.travelMinutes,effectiveKm:+(r.km+replacement.kmDelta).toFixed(3),effectiveTravelMinutes:+((travelTime(r).minutes??0)+replacement.minutesDelta).toFixed(2),mobilityRefinement:replacement.segments}:r;
  });
  const excluded=new Map(ownership.flatMap(o=>o.moveIds.map(id=>[id,o.referenceId])));
  const additions=reconstruction.moves.filter(m=>!used.has(m.id)||partialMetrics.has(m.id)).map(m=>{
    const from=nodes.get(m.fromNodeId),to=nodes.get(m.toNodeId),mode=m.mode==='步行'?'步行':m.km>=30?'地面交通待定':m.mode;
    const partial=partialMetrics.get(m.id);
    return {...m,...(partial?{km:partial.km,travelMinutes:partial.travelMinutes,originalMoveKm:m.km,originalMoveTravelMinutes:m.travelMinutes,metricFraction:1-partial.coveredFraction,
      distanceRange:m.distanceRange.map(n=>+(n*(1-partial.coveredFraction)).toFixed(3)),durationRange:m.durationRange.map(n=>+(n*(1-partial.coveredFraction)).toFixed(3))}:{}),id:'MOB-'+m.id,points:[[from.lat,from.lon],[to.lat,to.lon]],names:[from.name,to.name],countries:[from.country,to.country],nodes:[from,to],
      nodeRefs:[from,to].map(n=>({id:n.id,name:n.name,point:[n.lat,n.lon],country:n.country,type:'定位节点'})),nodeIds:[from.id,to.id],nodePlaceIds:['',''],
      mode,include:true,status:'合理重构',mobility:true,journeyId:m.tripId,journeyName:m.date+'移动',source:GLOBAL_EVIDENCE_FILE,
      evidence:m.evidenceReferences.join('；'),distanceBasis:m.measurementBasis,travelDurationBasis:m.measurementBasis,minutes:null};
  });
  const referenceKm=reference.filter(r=>r.countDistance!==false).reduce((s,r)=>s+(r.effectiveKm??r.km??0),0),newKm=additions.reduce((s,r)=>s+r.km,0);
  return {reference,additions,ownership,replacements:[...replacements].map(([id,r])=>({id,...r})),excluded:[...excluded].map(([id,referenceId])=>({id,referenceId})),
    summary:{reconstructedMoves:reconstruction.moves.length,additionalMoves:additions.length,coveredMoves:used.size,refinedReferences:replacements.size,
      partlyCoveredMoves:partialMetrics.size,referenceKm:+referenceKm.toFixed(3),additionalKm:+newKm.toFixed(3),totalKm:+(referenceKm+newKm).toFixed(3),conflicts:reconstruction.conflicts.length}};
}

export function effectiveMobilityRoutes(mobility){
  return [...mobility.reference.map(r=>r.effectiveKm===undefined?r:{...r,km:r.effectiveKm,travelMinutes:r.effectiveTravelMinutes,distanceType:'model',durationType:'model',
    distanceBasis:'原交通代表值经完整连续GPS链校准；原值保留于sourceKm',travelDurationBasis:'原交通时长经同一连续GPS窗口去停留校准'}),...mobility.additions];
}

export function projectMobility(reconstruction,config,geometry,places=[]){
  const sourceNodes=new Map(reconstruction.nodes.map(n=>[n.id,n])),nodes=new Map();
  const adapt=id=>{
    if(nodes.has(id))return nodes.get(id);const p=sourceNodes.get(id),district=geometry.features.find(f=>pointInFeature([p.lon,p.lat],f));
    const near=places.find(q=>q.level!=='区域接续'&&distance([p.lat,p.lon],[q.lat,q.lon])<.2);
    const node={...p,name:near?.name||p.name,cityId:district?config.id:null,districtId:district?.id||null};nodes.set(id,node);return node;
  };
  const moves=reconstruction.moves.filter(m=>[m.fromNodeId,m.toNodeId].some(id=>adapt(id).cityId===config.id)).map(m=>({...m}));
  const ids=new Set(moves.map(m=>m.id)),visitIds=new Set(moves.flatMap(m=>[m.fromVisitId,m.toVisitId]));
  const visits=reconstruction.visits.filter(v=>visitIds.has(v.id)).map(v=>{const copy={...v,incoming:v.incoming.filter(id=>ids.has(id)),outgoing:v.outgoing.filter(id=>ids.has(id))};
    if(!copy.incoming.length||!copy.outgoing.length)copy.boundary||='区域投影边界';return copy;});
  const groups=new Map();for(const m of moves){if(!groups.has(m.tripId))groups.set(m.tripId,[]);groups.get(m.tripId).push(m);}
  const journeys=[...groups].map(([id,chain])=>{chain.sort((a,b)=>a.start-b.start);chain.forEach((m,i)=>{m.originOrder=m.order;m.order=i+1;});return {id,cityId:config.id,first:chain[0].startDate,last:chain.at(-1).endDate,moveIds:chain.map(m=>m.id),kind:'regional-projection'};});
  const usedNodes=new Set(moves.flatMap(m=>[m.fromNodeId,m.toNodeId])),internal=moves.filter(m=>adapt(m.fromNodeId).cityId===config.id&&adapt(m.toNodeId).cityId===config.id);
  return {...reconstruction,nodes:[...usedNodes].map(adapt),moves,visits,journeys,stationary:[],conflicts:reconstruction.conflicts.filter(c=>c.fromNodeId&&usedNodes.has(c.fromNodeId)||c.toNodeId&&usedNodes.has(c.toNodeId)),
    summary:{journeys:journeys.length,moves:internal.length,gpsMoves:internal.filter(m=>m.sourceKind==='gps').length,gapMoves:internal.filter(m=>m.sourceKind==='gap').length,
      km:+internal.reduce((s,m)=>s+m.km,0).toFixed(2),travelMinutes:+internal.reduce((s,m)=>s+m.travelMinutes,0).toFixed(2),source:'global-mobility-ledger',
      distanceRange:[0,1].map(i=>+internal.reduce((s,m)=>s+m.distanceRange[i],0).toFixed(2)),durationRange:[0,1].map(i=>+internal.reduce((s,m)=>s+m.durationRange[i],0).toFixed(2))}};
}

export async function loadGlobalMobility(folder,atlas,source){
  let evidence;try{evidence=JSON.parse(await readFile(sourcePath(source||{type:'obsidian',folder},GLOBAL_EVIDENCE_FILE),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}
  if(!evidence.tracks?.length&&!evidence.photoPoints?.length&&!evidence.stays?.length)return null;
  const resolveNode=await globalNodeResolver(atlas,evidence),references=atlas.routes.filter(r=>r.include!==false&&!r.structuralLink&&r.countDistance!==false&&!['计划','计划航班','待飞','排除'].includes(r.status));
  const canConnect=(a,b,window)=>{
    if(window.kind==='gps')return true;
    const separation=distance([a.lat,a.lon],[b.lat,b.lon]);
    if(separation>=100){
      const coveredBy=archivalMovementCover(references,a,b,window);
      if(coveredBy.length)return {coveredBy};
    }
    return separation<=400;
  };
  const reconstruction=classifyObservationConflicts(reconstructCity({config:{id:'global',timeZone:'UTC',timeZoneAt:locationTimeZone,maxSpeed:320,regional:true},evidence,resolveNode,canConnect}),references);
  const ledger=reconcileMobility(atlas.routes,reconstruction);
  return {...ledger,reconstruction,observations:evidence.summary,source:evidence.source,policy:evidence.policy};
}
