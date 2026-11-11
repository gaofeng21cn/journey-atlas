import {createHash} from 'node:crypto';
import {greatCircleKm,trajectoryRows,nodeAliases} from './travel-layers.mjs';

// A place is a lasting identity. A visit is one occurrence inside one journey.
// These rows belong to the journey layer; they do not establish a new visit,
// a mode of transport, a distance or a precise timestamp by themselves.
export const VISIT_INSTANCES='全旅程数据点-到访实例.csv';
export const VISIT_INSTANCE_HEADERS=Object.freeze([
  '到访编号','地点编号','行程编号','开始日期','结束日期','时间精度','活动性质',
  '进入交通编号','离开交通编号','前序到访编号','后序到访编号','接续核定',
  '核定方式','证据引用','核定记录','关联正文','分享纳入','开放边界','边界依据',
]);

const fields=value=>[...new Set(String(value||'').split(/[；;]/).map(s=>s.trim()).filter(Boolean))];
const values=input=>input instanceof Map?[...input.values()]:Array.isArray(input)?input:input?.places||input?.journeys||[];
const index=input=>new Map(values(input).map(v=>[v.id,v]));
const sourceUnion=items=>[...new Set(items.flatMap(s=>fields(s)))].join('；');
const activities=new Set(['地面到访','交通接触','区域接续','计划到访']);
const plannedRoute=route=>route?.status==='计划'||route?.review?.conclusion==='计划';
const reviews=new Set(['已核','有据重构','待还原']);
const boundaries=new Set(['','开始','结束','开始及结束']);

function datePart(value,label){
  const text=String(value||'');
  if(!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(text))throw new Error(`${label}须为年、年月或日期：${text}`);
  const [year,month,day]=text.split('-').map(Number);
  if(month!==undefined&&(month<1||month>12)||day!==undefined&&(day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate()))throw new Error(`${label}日期无效：${text}`);
  const min=Date.UTC(year,(month||1)-1,day||1);
  const max=day!==undefined?min:month!==undefined?Date.UTC(year,month,0):Date.UTC(year,11,31);
  return {text,min,max};
}

function timeWindow(record,{required=true}={}){
  const dates=String(record.date||'').match(/\d{4}(?:-\d{2}(?:-\d{2})?)?/g)||[];
  const start=record.startDate||dates[0]||'',end=record.endDate||dates.at(-1)||start;
  if(!start&&!required)return null;
  const a=datePart(start,'开始日期'),b=datePart(end,'结束日期');
  if(b.max<a.min)throw new Error(`结束日期早于开始日期：${start}—${end}`);
  return {startDate:start,endDate:end,min:a.min,max:b.max,timePrecision:record.timePrecision||
    (start!==end?'区间':start.length===10?'日':start.length===7?'月':'年')};
}

const intersect=(a,b)=>a.min<=b.max&&b.min<=a.max;
const nodeRefs=(route,places)=>(route.nodeRefs||route.nodeIds?.map((id,i)=>({id,placeId:places.has(id)?id:'',point:route.points?.[i]}))||route.nodePlaceIds?.map((id,i)=>({id,placeId:places.has(id)?id:'',point:route.points?.[i]}))||[]);
const samePoint=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===2&&b.length===2&&a.every(Number.isFinite)&&b.every(Number.isFinite)&&greatCircleKm(a,b)<=0.05;
const rawPoint=(route,refs,i)=>refs[i]?.point||route.points?.[i];

function context({places=[],routes=[],journeys=[],connectors=[]}={}){
  const placeIndex=index(places),journeyIndex=index(journeys),routeIndex=index(routes);
  // Only explicitly maintained connectors are movements. Candidate connectors
  // and zero-distance covered markers cannot establish entry or exit.
  for(const r of connectors)if(r.nodeRefs&&['接驳段','资料间隔','节点对应'].includes(r.recordType)&&r.include!==false&&!r.covered)routeIndex.set(r.id,r);
  const registration=new Map();
  for(const j of journeyIndex.values())(j.transportIds||j.transport?.map(r=>r.id)||[]).forEach((id,i)=>registration.set(id,i));
  const sorted=[...routeIndex.values()].filter(r=>r.include!==false).map((r,i)=>({...r,_inputOrder:i,_window:timeWindow(r,{required:false})})).sort((a,b)=>
    (a._window?.min??Infinity)-(b._window?.min??Infinity)||
    (a.sequence??registration.get(a.id)??a.registrationIndex??a._inputOrder)-(b.sequence??registration.get(b.id)??b.registrationIndex??b._inputOrder)||a._inputOrder-b._inputOrder);
  const ordinary=sorted.filter(r=>!['接驳段','资料间隔','节点对应'].includes(r.recordType)).map(r=>{
    const refs=nodeRefs(r,placeIndex);
    return {...r,nodeRefs:refs,nodeIds:refs.map(n=>n.id),points:r.points||refs.map(n=>n.point),
      names:r.names||refs.map(n=>n.name||placeIndex.get(n.placeId||n.id)?.name||n.id)};
  });
  for(const r of ordinary)routeIndex.set(r.id,r);
  const orderedJourneys=[...journeyIndex.values()].map(j=>({...j,transport:
    (j.transportIds||j.transport?.map(r=>r.id)||ordinary.filter(r=>r.journeyId===j.id).map(r=>r.id))
      .map(id=>routeIndex.get(id)).filter(r=>r&&!['接驳段','资料间隔','节点对应'].includes(r.recordType))}));
  // One chronological owner for trajectory, visit migration and maintenance.
  // Keep segment order: a trunk can resume after a branch, so ordering whole
  // routes alone would create a false isolated visit at the branch junction.
  const segments=trajectoryRows(ordinary,orderedJourneys,{aliases:nodeAliases(ordinary)}).map(row=>({
    route:routeIndex.get(row['交通编号']),nodeIndex:Number(String(row['路线段']).split('/')[0]),row,
  })).filter(s=>s.route&&Number.isInteger(s.nodeIndex));
  const positions=new Map();
  for(const {route} of segments)if(!positions.has(route.id))positions.set(route.id,positions.size);
  const orderedOrdinary=[...positions.keys()].map(id=>routeIndex.get(id));
  return {places:placeIndex,routes:routeIndex,journeys:journeyIndex,registration,sorted,ordinary:orderedOrdinary,segments,positions};
}

function segmentNumber(value,route){
  const raw=String(value??'').split('/')[0];
  const parsed=raw===''?(route?.nodeRefs?.length===2||route?.nodeIds?.length===2||route?.nodePlaceIds?.length===2?1:null):Number(raw);
  return Number.isInteger(parsed)&&parsed>0?parsed:null;
}

function connectionAnchors(route,ctx){
  const previous=ctx.routes.get(route.previousTransport),next=ctx.routes.get(route.nextTransport);
  if(!previous||!next||previous.include===false||next.include===false)return null;
  const p=segmentNumber(route.previousSegment,previous),n=segmentNumber(route.nextSegment,next);
  const previousRefs=nodeRefs(previous,ctx.places),nextRefs=nodeRefs(next,ctx.places),refs=nodeRefs(route,ctx.places);
  if(!p||!n||p>=previousRefs.length||n>=nextRefs.length||refs.length!==2)return null;
  if(previousRefs[p].id!==refs[0].id||nextRefs[n-1].id!==refs[1].id)return null;
  if(!samePoint(rawPoint(previous,previousRefs,p),rawPoint(route,refs,0))||
    !samePoint(rawPoint(next,nextRefs,n-1),rawPoint(route,refs,1)))return null;
  if(!previousRefs[p].id||!nextRefs[n-1].id)return null;
  if(route.recordType==='资料间隔'&&(refs[0].id!==refs[1].id||!ctx.places.has(refs[0].id)||!samePoint(rawPoint(route,refs,0),rawPoint(route,refs,1))))return null;
  return {previous,next,previousSegment:p,nextSegment:n,refs};
}

function inPlaceActivity(route,refs,i,placeId){
  return refs[i-1]?.id===placeId&&refs[i]?.id===placeId&&samePoint(rawPoint(route,refs,i-1),rawPoint(route,refs,i));
}

// A documented in-city activity can be the exact anchor next to a managed
// connection without becoming a fictitious entering/leaving edge itself.
// Follow the one chronological segment chain to a real entry or exit; a name,
// a matching city centre or an unrelated loop elsewhere does not suffice.
function activityAnchoredTo(route,segmentIndex,side,refs,placeId,ctx){
  const nodes=nodeRefs(route,ctx.places);
  if(!inPlaceActivity(route,nodes,segmentIndex,placeId))return false;
  const start=ctx.segments.findIndex(s=>s.route.id===route.id&&s.nodeIndex===segmentIndex);
  if(start<0)return false;
  const step=side==='incoming'?-1:1;let previousRoute=route;
  const point=rawPoint(route,nodes,segmentIndex);
  for(let k=start+step;k>=0&&k<ctx.segments.length;k+=step){
    const segment=ctx.segments[k],r=segment.route,ns=nodeRefs(r,ctx.places),i=segment.nodeIndex;
    if(r.journeyId!==route.journeyId||!mayStay(side==='incoming'?r._window:previousRoute._window,
      side==='incoming'?previousRoute._window:r._window,route.journeyId,route.journeyId,ctx))return false;
    const anchor=side==='incoming'?i:i-1;
    if(ns[anchor]?.id!==placeId||!samePoint(rawPoint(r,ns,anchor),point))return false;
    if(inPlaceActivity(r,ns,i,placeId)){previousRoute=r;continue;}
    return refs.includes(r.id)&&directions(r,placeId,ctx)[side].includes(anchor);
  }
  return false;
}

function directions(route,placeId,ctx){
  const refs=nodeRefs(route,ctx.places),incoming=[],outgoing=[];
  const physicalSamePlaceTransfer=route.recordType==='接驳段'&&refs.length===2&&refs[0].id===refs[1].id&&
    !samePoint(rawPoint(route,refs,0),rawPoint(route,refs,1));
  if(route.recordType==='资料间隔'||physicalSamePlaceTransfer||route.recordType==='节点对应'){
    const anchors=route.recordType==='节点对应'||physicalSamePlaceTransfer||route.structuralLink&&route.status==='待还原'?connectionAnchors(route,ctx):null;
    if(anchors)return {refs,incoming:refs[1].id===placeId?[1]:[],outgoing:refs[0].id===placeId?[0]:[]};
    return {refs,incoming,outgoing};
  }
  for(let i=0;i<refs.length;i++)if(refs[i].placeId===placeId||refs[i].id===placeId&&ctx.places.has(placeId)){
    // A city display point or servicePlaceId is never a visit endpoint.
    if(i>0&&refs[i-1].id!==refs[i].id)incoming.push(i);
    if(i<refs.length-1&&refs[i+1].id!==refs[i].id)outgoing.push(i);
  }
  return {refs,incoming,outgoing};
}

function sharedMovement(from,to,ctx){
  for(const id of from.outgoing.filter(id=>to.incoming.includes(id))){
    const r=ctx.routes.get(id),a=directions(r,from.placeId,ctx),b=directions(r,to.placeId,ctx);
    if(a.outgoing.some(i=>b.incoming.some(j=>j>i)))return true;
  }
  return false;
}

function documentedStay(fromJourney,toJourney,ctx){
  const a=ctx.journeys.get(fromJourney),b=ctx.journeys.get(toJourney);
  return Boolean(a?.closureGroup&&a.closureGroup===b?.closureGroup&&a.closureBasis&&b.closureBasis);
}

function mayStay(first,last,fromJourney,toJourney,ctx){
  return last.min-first.max<=86400000||documentedStay(fromJourney,toJourney,ctx);
}

// The only side supplied by another visit is a stationary continuation at the
// exact raw node. Nearby airports, names and visual city centres do not qualify.
function stationaryContinuation(from,to,ctx){
  if(from.placeId!==to.placeId||from._window.max>to._window.max&&from._window.min>to._window.min)return false;
  for(const inId of from.incoming)for(const outId of to.outgoing){
    const a=ctx.routes.get(inId),b=ctx.routes.get(outId);
    if(!a||!b||ctx.positions.get(outId)!==ctx.positions.get(inId)+1)continue;
    const ar=nodeRefs(a,ctx.places),br=nodeRefs(b,ctx.places);
    const aw=timeWindow(a),bw=timeWindow(b);
    if(!mayStay(aw,bw,from.journeyId,to.journeyId,ctx))continue;
    if(ar.at(-1)?.id===from.placeId&&br[0]?.id===to.placeId&&samePoint(rawPoint(a,ar,ar.length-1),rawPoint(b,br,0))&&
      aw.min<=bw.max)return true;
  }
  return false;
}

function linkHasMovement(from,to,ctx){
  if(from._window.min>to._window.max)return false;
  return sharedMovement(from,to,ctx)||stationaryContinuation(from,to,ctx);
}

function accessFor(visit,visitIndex,ctx){
  const previous=visit.previous?visitIndex.get(visit.previous):null,next=visit.next?visitIndex.get(visit.next):null;
  const continuedIn=previous&&stationaryContinuation(previous,visit,ctx);
  const continuedOut=next&&stationaryContinuation(visit,next,ctx);
  const openIn=['开始','开始及结束'].includes(visit.openBoundary),openOut=['结束','开始及结束'].includes(visit.openBoundary);
  const entered=visit.incoming.length>0||continuedIn||openIn,left=visit.outgoing.length>0||continuedOut||openOut;
  const resolved=visit.continuity!=='待还原';
  const missing=[];
  if(!entered)missing.push('本次到访缺进入移动');
  if(!left)missing.push('本次到访缺离开移动');
  if(!resolved)missing.push('接续尚未核定');
  const complete=Boolean(entered&&left);
  const state=!visit.include?'排除':!complete?'待接入':!resolved?'待还原':visit.continuity==='有据重构'?'有据重构':'完整接续';
  return {state,complete,pending:visit.include&&!complete,incoming:[...visit.incoming],outgoing:[...visit.outgoing],
    previous:visit.previous,next:visit.next,continuedIn:Boolean(continuedIn),continuedOut:Boolean(continuedOut),
    entered:Boolean(entered),left:Boolean(left),reason:missing.join('；')};
}

// A reviewed multi-day occurrence owns its whole window. Regeneration must not
// split it back into two one-day occurrences and reintroduce an artificial gap.
export function mergeReviewedVisitRows(inferred,manual){
  const contained=(v,m)=>v['地点编号']===m['地点编号']&&v['行程编号']===m['行程编号']&&
    v['开始日期']>=m['开始日期']&&v['结束日期']<=m['结束日期'];
  const replaced=new Map();
  for(const v of inferred){const m=manual.find(m=>contained(v,m));if(m)replaced.set(v['到访编号'],m['到访编号']);}
  return [...inferred.filter(v=>!replaced.has(v['到访编号'])).map(v=>({...v,
    '前序到访编号':replaced.get(v['前序到访编号'])||v['前序到访编号'],
    '后序到访编号':replaced.get(v['后序到访编号'])||v['后序到访编号']})),...manual];
}

/** Read the maintained occurrence table without promoting inferred facts. */
export function readVisitInstances(rows,options={}){
  const ctx=context(options),ids=new Set();
  const instances=rows.map(row=>{
    const id=row['到访编号'];
    if(!id||ids.has(id))throw new Error('到访编号为空或重复：'+id);ids.add(id);
    const placeId=row['地点编号'],journeyId=row['行程编号']||'',place=ctx.places.get(placeId);
    if(!place)throw new Error('到访地点不存在：'+id+' / '+placeId);
    if(journeyId&&!ctx.journeys.has(journeyId))throw new Error('到访行程不存在：'+id+' / '+journeyId);
    const window=timeWindow({startDate:row['开始日期'],endDate:row['结束日期'],timePrecision:row['时间精度']});
    if(!['日','月','年','区间'].includes(window.timePrecision))throw new Error('到访时间精度无效：'+id);
    const activity=row['活动性质'],continuity=row['接续核定'],openBoundary=row['开放边界']||'';
    if(!activities.has(activity))throw new Error('到访活动性质无效：'+id);
    if(activity==='地面到访'&&place.status!=='已到访')throw new Error('地面到访实例须引用已核地点：'+id);
    if(!reviews.has(continuity))throw new Error('到访接续核定无效：'+id);
    if(!boundaries.has(openBoundary)||openBoundary&&!row['边界依据'])throw new Error('开放边界无效或缺边界依据：'+id);
    if(!['纳入','排除'].includes(row['分享纳入']))throw new Error('到访分享纳入无效：'+id);
    if(row['分享纳入']==='纳入'&&place.include===false)throw new Error('排除地点不能通过到访实例重新纳入：'+id);
    if(!row['关联正文'])throw new Error('到访实例缺关联正文：'+id);
    if(continuity!=='待还原'&&(!row['核定方式']||!row['证据引用']||!row['核定记录']))throw new Error('核定到访缺方式、证据引用或核定记录：'+id);
    const journey=ctx.journeys.get(journeyId),journeyWindow=journey?timeWindow(journey,{required:false}):null;
    const preciseOutside=journeyWindow&&(window.startDate.length===10&&window.min<journeyWindow.min||window.endDate.length===10&&window.max>journeyWindow.max);
    // A coarse month/year intersects a narrower documented journey without
    // revealing the day. Preserve its source precision rather than fabricating
    // a clipped timestamp or declaring an unproven date contradiction.
    if(journeyWindow&&(preciseOutside||!intersect(window,journeyWindow)))throw new Error('到访日期超出行程范围：'+id);
    const incoming=fields(row['进入交通编号']),outgoing=fields(row['离开交通编号']);
    for(const [refs,side] of [[incoming,'incoming'],[outgoing,'outgoing']])for(const transport of refs){
      const route=ctx.routes.get(transport);
      if(!route||route.include===false)throw new Error('到访引用交通不存在或已排除：'+id+' / '+transport);
      if(!intersect(window,timeWindow(route)))throw new Error('到访引用交通与本次时间不相交：'+id+' / '+transport);
      if(!directions(route,placeId,ctx)[side].length)throw new Error('交通未实际进入/离开本地点编号：'+id+' / '+transport);
      if(journeyId&&route.journeyId&&route.journeyId!==journeyId&&!['接驳段','资料间隔','节点对应'].includes(route.recordType))throw new Error('交通属于另一行程，请通过到访承接引用：'+id+' / '+transport);
      if(route.recordType==='资料间隔'&&incoming.includes(transport)&&outgoing.includes(transport))throw new Error('资料间隔须连接不同到访实例，不能自补入出边：'+id+' / '+transport);
      if(route.recordType==='接驳段'&&route.structuralLink&&incoming.includes(transport)&&outgoing.includes(transport))throw new Error('必要待还原连接不能给同一次到访自补入出边：'+id+' / '+transport);
      if(['接驳段','资料间隔','节点对应'].includes(route.recordType)){
        const anchors=connectionAnchors(route,ctx);
        if(!anchors)throw new Error('到访必要连接缺精确的前后交通段绑定：'+id+' / '+transport);
        const bindsOwnVisit=side==='incoming'?
          outgoing.includes(anchors.next.id)||activityAnchoredTo(anchors.next,anchors.nextSegment,'outgoing',outgoing,placeId,ctx):
          incoming.includes(anchors.previous.id)||activityAnchoredTo(anchors.previous,anchors.previousSegment,'incoming',incoming,placeId,ctx);
        if(!bindsOwnVisit)throw new Error('必要连接不能补到无关到访实例：'+id+' / '+transport);
        if((route.structuralLink||route.status==='待还原')&&continuity!=='待还原')throw new Error('必要待还原连接不能抬高接续核定：'+id+' / '+transport);
      }
    }
    const originalTransport=[...new Set([...incoming,...outgoing])].map(id=>ctx.routes.get(id))
      .filter(r=>!['接驳段','资料间隔','节点对应'].includes(r.recordType)&&!r.structuralLink);
    if(activity==='地面到访'&&originalTransport.length&&originalTransport.every(plannedRoute))throw new Error('仅计划交通不能核为本次地面到访：'+id);
    return {id,placeId,journeyId,...window,_window:window,activity,incoming,outgoing,
      previous:row['前序到访编号']||'',next:row['后序到访编号']||'',continuity,
      reviewMethod:row['核定方式']||'',evidence:row['证据引用']||'',reviewRecord:row['核定记录']||'',
      source:row['关联正文'],include:row['分享纳入']==='纳入',openBoundary,boundaryEvidence:row['边界依据']||''};
  });
  const visitIndex=new Map(instances.map(v=>[v.id,v]));
  for(const v of instances){
    for(const [id,side] of [[v.previous,'previous'],[v.next,'next']])if(id){
      const linked=visitIndex.get(id);
      if(!linked||id===v.id)throw new Error('前后到访不存在或自引用：'+v.id+' / '+id);
      if(side==='previous'?linked.next!==v.id:linked.previous!==v.id)throw new Error('前后到访必须相互引用：'+v.id+' / '+id);
      if(!(side==='previous'?linkHasMovement(linked,v,ctx):linkHasMovement(v,linked,ctx)))throw new Error('前后到访缺原始节点与交通承接：'+v.id+' / '+id);
    }
    v.access=accessFor(v,visitIndex,ctx);
    if(v.continuity!=='待还原'&&(v.access.pending&&v.include))throw new Error('本次到访尚缺进出边，不能核为完整：'+v.id+' / '+v.access.reason);
  }
  const completed=new Set();
  for(const v of instances){
    const chain=new Set();let current=v;
    while(current&&!completed.has(current.id)){
      if(chain.has(current.id))throw new Error('到访前后引用成环；往返须拆为不同到访实例：'+current.id);
      chain.add(current.id);current=visitIndex.get(current.next);
    }
    for(const id of chain)completed.add(id);
  }
  return instances;
}

function candidateId(journeyId,placeId,routeId,nodeIndex){
  return 'V-'+createHash('sha256').update(JSON.stringify([journeyId,placeId,routeId,nodeIndex])).digest('hex').slice(0,16);
}

/** Produce reviewable migration candidates. No inferred connector or service city upgrades them. */
export function deriveVisitInstances(options={}){
  const ctx=context(options),instances=[];let previousArrival=null;
  const event=(route,refs,i,side,reuse=null)=>{
    const ref=refs[i],placeId=ref?.placeId||(ctx.places.has(ref?.id)?ref.id:''),place=ctx.places.get(placeId);
    if(!place||!directions(route,placeId,ctx)[side].includes(i))return null;
    const window=route._window,journeyId=route.journeyId||'';let visit=reuse;
    if(!visit){
      const dates=timeWindow({startDate:window.startDate,endDate:window.endDate});
      let id=candidateId(journeyId,placeId,route.id,i),occurrence=1;
      while(instances.some(v=>v.id===id))id=candidateId(journeyId,placeId,route.id,`${i}:${side}:${++occurrence}`);
      visit={id,placeId,journeyId,...dates,_window:dates,
        activity:plannedRoute(route)?'计划到访':place.status==='已到访'?'地面到访':place.status==='途经/机场'?'交通接触':'区域接续',
        incoming:[],outgoing:[],previous:'',next:'',continuity:'待还原',reviewMethod:'历史迁移',
        evidence:route.source||'',reviewRecord:'保留原始节点及交通身份；引用完整不代表到访、方式或时间已经核定',
        source:sourceUnion([route.source,place.source]),include:route.include!==false&&place.include!==false,openBoundary:'',boundaryEvidence:'',occurrences:[]};
      instances.push(visit);
    }else{
      if(!plannedRoute(route)&&place.status==='已到访'&&intersect(window,visit._window))visit.activity='地面到访';
      if(window.min<visit._window.min)visit.startDate=window.startDate;
      if(window.max>visit._window.max)visit.endDate=window.endDate;
      visit._window=timeWindow({...visit,timePrecision:''});visit.timePrecision=visit._window.timePrecision;
      visit.source=sourceUnion([visit.source,route.source]);visit.evidence=sourceUnion([visit.evidence,route.source]);
    }
    visit[side]=[...new Set([...visit[side],route.id])];
    if(!visit.occurrences.some(o=>o.routeId===route.id&&o.nodeIndex===i))visit.occurrences.push({routeId:route.id,nodeIndex:i});
    return visit;
  };
  for(const {route,nodeIndex:i} of ctx.segments){
    if(!route._window)continue;const refs=nodeRefs(route,ctx.places),journeyId=route.journeyId||'',window=route._window;
    const joinsPrevious=previousArrival?.visit&&previousArrival.visit.journeyId===journeyId&&
      previousArrival.ref.id===refs[i-1]?.id&&samePoint(previousArrival.point,rawPoint(route,refs,i-1))&&
      previousArrival.window.min<=window.max&&mayStay(previousArrival.window,window,journeyId,journeyId,ctx);
    if(joinsPrevious&&inPlaceActivity(route,refs,i,previousArrival.visit.placeId)){
      const visit=previousArrival.visit;
      visit.activityTransports=[...new Set([...(visit.activityTransports||[]),route.id])];
      for(const nodeIndex of [i-1,i])if(!visit.occurrences.some(o=>o.routeId===route.id&&o.nodeIndex===nodeIndex))visit.occurrences.push({routeId:route.id,nodeIndex});
      if(window.min<visit._window.min)visit.startDate=window.startDate;
      if(window.max>visit._window.max)visit.endDate=window.endDate;
      visit._window=timeWindow({...visit,timePrecision:''});visit.timePrecision=visit._window.timePrecision;
      visit.source=sourceUnion([visit.source,route.source]);visit.evidence=sourceUnion([visit.evidence,route.source]);
      previousArrival={visit,ref:refs[i],point:rawPoint(route,refs,i),window};
      continue;
    }
    const departure=event(route,refs,i-1,'outgoing',joinsPrevious?previousArrival.visit:null);
    const arrival=event(route,refs,i,'incoming');
    if(departure&&arrival&&departure.id!==arrival.id&&!departure.next&&!arrival.previous){departure.next=arrival.id;arrival.previous=departure.id;}
    previousArrival={visit:arrival,ref:refs[i],point:rawPoint(route,refs,i),window};
  }
  // Keep genuinely evidenced places visible as unresolved occurrences even
  // when no movement points at them. Never manufacture a nearest-base loop.
  const represented=new Set(instances.map(v=>v.placeId));
  for(const place of ctx.places.values())if(place.include!==false&&place.status==='已到访'&&!represented.has(place.id)){
    const dates=timeWindow({startDate:place.first,endDate:place.last||place.first},{required:false});
    if(!dates)continue;
    instances.push({id:candidateId('',place.id,'地点证据',0),placeId:place.id,journeyId:'',...dates,_window:dates,
      activity:'地面到访',incoming:[],outgoing:[],previous:'',next:'',continuity:'待还原',reviewMethod:'地点证据迁移候选',
      evidence:place.source||'',reviewRecord:'地点已核；到访时间窗口及进出移动尚未还原，不凭最近基地补造往返',
      source:place.source||'',include:true,openBoundary:'',boundaryEvidence:''});
  }
  // Different journeys keep distinct visits. Adjacent real route endpoints can
  // propose a stationary hand-off, but the candidate still requires review.
  for(let i=1;i<ctx.ordinary.length;i++){
    const a=ctx.ordinary[i-1],b=ctx.ordinary[i];
    if(a.journeyId===b.journeyId)continue;
    const aRef=nodeRefs(a,ctx.places).at(-1),bRef=nodeRefs(b,ctx.places)[0];
    if(!aRef?.placeId||aRef.id!==bRef?.id)continue;
    const from=instances.findLast(v=>v.journeyId===(a.journeyId||'')&&v.placeId===aRef.placeId&&v.incoming.includes(a.id));
    const to=instances.find(v=>v.journeyId===(b.journeyId||'')&&v.placeId===bRef.placeId&&v.outgoing.includes(b.id));
    if(from&&to&&!from.next&&!to.previous&&stationaryContinuation(from,to,ctx)){from.next=to.id;to.previous=from.id;}
  }
  // A managed connection supplies the missing side of an existing occurrence.
  // It never seeds another trip or promotes a transport contact to a visit.
  // Requiring the exact preceding/following segment prevents a same-place link
  // from completing a different visit somewhere else in its lifetime.
  const connectionIssues=[];
  for(const route of ctx.sorted.filter(r=>['接驳段','资料间隔','节点对应'].includes(r.recordType))){
    const anchors=connectionAnchors(route,ctx);
    if(!anchors){connectionIssues.push({id:route.id,reason:'前后交通段与原始端点未精确绑定'});continue;}
    const window=route._window;if(!window){connectionIssues.push({id:route.id,reason:'必要连接缺时间窗口'});continue;}
    const fromId=anchors.refs[0].placeId||(ctx.places.has(anchors.refs[0].id)?anchors.refs[0].id:'');
    const toId=anchors.refs[1].placeId||(ctx.places.has(anchors.refs[1].id)?anchors.refs[1].id:'');
    const match=(placeId,side,transport,nodeIndex)=>instances.filter(v=>v.placeId===placeId&&intersect(v._window,window)&&
      (v[side].includes(transport)||v.activityTransports?.includes(transport))&&v.occurrences?.some(o=>o.routeId===transport&&o.nodeIndex===nodeIndex));
    const from=fromId?match(fromId,'incoming',anchors.previous.id,anchors.previousSegment):[];
    const to=toId?match(toId,'outgoing',anchors.next.id,anchors.nextSegment-1):[];
    if(fromId&&from.length!==1)connectionIssues.push({id:route.id,reason:'前序到访缺失或对应到访实例不唯一'});
    if(toId&&to.length!==1)connectionIssues.push({id:route.id,reason:'后序到访缺失或对应到访实例不唯一'});
    if(route.recordType==='资料间隔'&&(from.length!==1||to.length!==1||from[0].id===to[0].id)){
      connectionIssues.push({id:route.id,reason:'资料间隔必须绑定两个不同到访实例'});continue;
    }
    const attach=(visit,side)=>{
      if(!visit)return;
      visit[side]=[...new Set([...visit[side],route.id])];
      visit.source=sourceUnion([visit.source,route.source]);visit.evidence=sourceUnion([visit.evidence,route.source]);
      visit.managedConnections=[...(visit.managedConnections||[]),route.id];
      if(route.structuralLink||route.status==='待还原'){
        visit.continuity='待还原';visit.reviewRecord+='；显式必要连接仅表结构接续，移动事实与方式仍待还原';
      }
    };
    attach(from.length===1?from[0]:null,'outgoing');attach(to.length===1?to[0]:null,'incoming');
    if(from.length===1&&to.length===1&&from[0].id!==to[0].id&&!from[0].next&&!to[0].previous){
      from[0].next=to[0].id;to[0].previous=from[0].id;
    }
  }
  instances.connectionIssues=connectionIssues;
  const visitIndex=new Map(instances.map(v=>[v.id,v]));
  for(const v of instances){
    const originals=[...new Set([...v.incoming,...v.outgoing])].map(id=>ctx.routes.get(id))
      .filter(r=>r&&!['接驳段','资料间隔','节点对应'].includes(r.recordType)&&!r.structuralLink);
    if(originals.length&&originals.every(plannedRoute))v.activity='计划到访';
    v.access=accessFor(v,visitIndex,ctx);
    const transport=[...new Set([...v.incoming,...v.outgoing])].map(id=>ctx.routes.get(id));
    // Inherit maintained evidence only. An explicit missing connection is a
    // useful structural edge, but its existence must remain unresolved.
    if(v.access.complete&&transport.length&&transport.every(r=>r?.evidence&&r?.source&&!r.structuralLink&&r.occurrenceStatus!=='待还原'&&r.status!=='待还原')){
      v.continuity='有据重构';v.reviewMethod='历史迁移';
      v.evidence=sourceUnion([...transport.map(r=>r.source),v.evidence]);
      v.reviewRecord='沿用已维护交通的原始节点、发生依据与事实状态；不增加新的到访、方式、班次或时间确认';
      v.access=accessFor(v,visitIndex,ctx);
    }
  }
  return instances;
}

export const visitInstanceRows=instances=>instances.map(v=>({
  '到访编号':v.id,'地点编号':v.placeId,'行程编号':v.journeyId||'','开始日期':v.startDate,'结束日期':v.endDate,
  '时间精度':v.timePrecision,'活动性质':v.activity,'进入交通编号':v.incoming.join('；'),'离开交通编号':v.outgoing.join('；'),
  '前序到访编号':v.previous||'','后序到访编号':v.next||'','接续核定':v.continuity,'核定方式':v.reviewMethod||'',
  '证据引用':v.evidence||'','核定记录':v.reviewRecord||'','关联正文':v.source||'','分享纳入':v.include?'纳入':'排除',
  '开放边界':v.openBoundary||'','边界依据':v.boundaryEvidence||'',
}));

// The available archive has two global observation boundaries. Local journey
// endpoints do not qualify: a missing return remains a managed unknown edge.
export function archiveBoundaryRows(atlas){
  const rows=visitInstanceRows(atlas.visitInstances),ordinary=new Set(atlas.routes.filter(r=>!['接驳段','资料间隔','节点对应'].includes(r.recordType)).map(r=>r.id));
  const first=atlas.trajectory.find(t=>ordinary.has(t['交通编号'])),last=atlas.trajectory.findLast(t=>ordinary.has(t['交通编号']));
  for(const row of rows){
    const start=!row['进入交通编号']&&first&&fields(row['离开交通编号']).includes(first['交通编号'])&&row['地点编号']===first['出发地点编号'];
    const end=!row['离开交通编号']&&last&&fields(row['进入交通编号']).includes(last['交通编号'])&&row['地点编号']===last['到达地点编号'];
    if(start||end){row['开放边界']=start&&end?'开始及结束':start?'开始':'结束';row['边界依据']='当前档案可用移动记录的全局时间边界；边界外交通尚未恢复，不表示历史旅程从此开始或结束';}
  }
  return rows;
}

export function visitInstanceSummary(instances){
  const shared=instances.filter(v=>v.include),pending=shared.filter(v=>v.access?.pending);
  return {records:instances.length,shared:shared.length,places:new Set(shared.map(v=>v.placeId)).size,
    confirmed:shared.filter(v=>v.continuity==='已核').length,reconstructed:shared.filter(v=>v.continuity==='有据重构').length,
    awaitingReview:shared.filter(v=>v.continuity==='待还原').length,complete:shared.filter(v=>v.access?.complete).length,
    pending:pending.length,missingIncoming:shared.filter(v=>!v.access?.entered).length,missingOutgoing:shared.filter(v=>!v.access?.left).length,
    openBoundaries:shared.filter(v=>v.openBoundary).length,
    byActivity:Object.fromEntries([...activities].map(activity=>[activity,shared.filter(v=>v.activity===activity).length])),
    pendingPlaceIds:[...new Set(pending.map(v=>v.placeId))],pendingIds:pending.map(v=>v.id),
    connectionIssues:instances.connectionIssues||[]};
}
