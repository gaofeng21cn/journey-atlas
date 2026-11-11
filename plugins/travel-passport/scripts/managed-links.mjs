import {createHash} from 'node:crypto';
import {GROUND_HEADERS,TABLES} from './schema.mjs';
import {greatCircleKm,routeTime,trajectoryRows} from './travel-layers.mjs';
import {deriveVisitInstances} from './visit-instances.mjs';

// This is a source migration proposal, not a route inference engine. A missing
// connection gets an explicit owner without acquiring an invented journey,
// transport mode, distance, duration or exact date.
const controlTypes=new Set(['接驳段','资料间隔','节点对应']);
const inactiveStatuses=new Set(['计划','计划航班','待飞','未发生','已取消','取消','排除']);
const field=(row,key,sourceKey)=>row?.[key]??row?.[sourceKey]??'';
const values=input=>input instanceof Map?[...input.values()]:Array.isArray(input)?input:[];
const split=value=>String(value||'').split(/[；;]/).map(x=>x.trim()).filter(Boolean);
const union=items=>[...new Set(items.flatMap(split))].join('；');
const positiveSegment=value=>{
  const n=Number(String(value??'').split('/')[0]);
  return Number.isInteger(n)&&n>0?n:null;
};
const validPoint=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180;
const actual=r=>r.include!==false&&!r.candidate&&!controlTypes.has(r.recordType)&&
  !inactiveStatuses.has(r.status)&&!['计划','排除'].includes(r.review?.conclusion||r.evidenceReview?.conclusion);

function bounds(date){
  const [year,month,day]=String(date).split('-').map(Number);
  return {min:Date.UTC(year,(month||1)-1,day||1),max:day?Date.UTC(year,month-1,day):month?Date.UTC(year,month,0):Date.UTC(year,11,31)};
}

function endpoint(row,route,side){
  const leg=positiveSegment(row['路线段']),i=side==='to'?leg:leg-1;
  if(!leg||leg>=route.points?.length)return null;
  const ref=route.nodeRefs?.[i];
  return {id:ref?.id||route.nodeIds?.[i]||'',placeId:ref?.placeId||route.nodePlaceIds?.[i]||'',
    name:route.names?.[i]||ref?.name||'',point:route.points?.[i],index:i};
}

function managedEndpoint(record,side){
  const ids=record.nodeIds||split(record['节点编号序列']);
  const points=record.points||(()=>{try{return JSON.parse(record['坐标序列纬经']||'[]');}catch{return [];}})();
  const i=side==='to'?ids.length-1:0;
  return {id:record.nodeRefs?.[i]?.id||ids[i]||'',point:points[i]};
}

const sameEndpoint=(a,b)=>a?.id&&b?.id&&a.id===b.id&&validPoint(a.point)&&validPoint(b.point)&&greatCircleKm(a.point,b.point)<=0.05;
const anchorMatches=(record,previous,next)=>
  field(record,'previousTransport','前序交通编号')===previous['交通编号']&&
  field(record,'nextTransport','后序交通编号')===next['交通编号']&&
  positiveSegment(field(record,'previousSegment','前序路线段'))===positiveSegment(previous['路线段'])&&
  positiveSegment(field(record,'nextSegment','后序路线段'))===positiveSegment(next['路线段']);

function sourceRef(route){
  const file=route.sourceTable||route.archiveFile||(route.recordType?TABLES.ground:TABLES.flightArchive);
  return `表行:${file}#${route.id}`;
}

function missingVisitPair(instances,from,to,previous,next,startDate,endDate){
  const connection={min:bounds(startDate).min,max:bounds(endDate).max};
  const intersects=v=>{
    const a=v.startDate||v['开始日期'],b=v.endDate||v['结束日期']||a;
    return a&&b&&bounds(a).min<=connection.max&&bounds(b).max>=connection.min;
  };
  const matches=(v,id,transport,side,nodeIndex)=>v.placeId===id&&v[side]?.includes(transport)&&intersects(v)&&
    (!v.occurrences||v.occurrences.some(o=>o.routeId===transport&&o.nodeIndex===nodeIndex));
  const arriving=instances.filter(v=>matches(v,from.placeId,previous['交通编号'],'incoming',from.index)&&!v.outgoing?.length);
  const leaving=instances.filter(v=>matches(v,to.placeId,next['交通编号'],'outgoing',to.index)&&!v.incoming?.length);
  return arriving.length===1&&leaving.length===1&&arriving[0].id!==leaving[0].id?[arriving[0],leaving[0]]:null;
}

function missingCoLocatedVisitSide(instances,from,to,previous,next,startDate,endDate,placeIndex){
  const connection={min:bounds(startDate).min,max:bounds(endDate).max};
  const match=(endpoint,transport,side,missing)=>{
    const placeId=endpoint.placeId||(placeIndex.has(endpoint.id)?endpoint.id:'');
    if(!placeId)return false;
    return instances.some(v=>v.placeId===placeId&&v[side]?.includes(transport)&&!v[missing]?.length&&
      v.startDate&&v.endDate&&bounds(v.startDate).min<=connection.max&&bounds(v.endDate).max>=connection.min&&
      (!v.occurrences||v.occurrences.some(o=>o.routeId===transport&&o.nodeIndex===endpoint.index)));
  };
  return match(from,previous['交通编号'],'incoming','outgoing')||match(to,next['交通编号'],'outgoing','incoming');
}

/**
 * Propose maintained missing connections from real consecutive traffic legs.
 * Shared formal place IDs retain their different raw endpoints as an unknown
 * transfer. Corrupt transport-node identity and definite reverse dates remain
 * issues; neither is "fixed" by a zero-distance connector.
 */
export function buildManagedLinkRows(atlas){
  const routes=values(atlas.routes).filter(actual),byId=new Map(routes.map(r=>[r.id,r]));
  const journeys=values(atlas.journeyLayer?.journeys||atlas.journeys);
  const aliases=atlas.journeyLayer?.aliases;
  const places=values(atlas.locationLayer?.places||atlas.places),placeIndex=new Map(places.map(p=>[p.id,p]));
  const managed=[...values(atlas.routes),...values(atlas.managedConnections),...values(atlas.managed)]
    .filter(r=>controlTypes.has(field(r,'recordType','记录类型')));
  // Source control rows are excluded from ordering; they bind the immutable
  // preceding/following legs instead of becoming another inferred trip.
  const trajectory=trajectoryRows(routes,journeys,{aliases});
  const instances=atlas.visitInstances||deriveVisitInstances({places,routes,journeys});
  const rows=[],issues=[],seen=new Set();let suppressed=0;
  for(let i=1;i<trajectory.length;i++){
    const previous=trajectory[i-1],next=trajectory[i],before=byId.get(previous['交通编号']),after=byId.get(next['交通编号']);
    if(!before||!after)continue;
    // The registered node order already connects successive legs of a single
    // route. Its whole time window is not a per-leg arrival/departure date.
    if(before.id===after.id&&positiveSegment(next['路线段'])===positiveSegment(previous['路线段'])+1)continue;
    const from=endpoint(previous,before,'to'),to=endpoint(next,after,'from');
    const issue=(type,message)=>issues.push({type,message,previousTransport:before.id,nextTransport:after.id,
      previousSegment:positiveSegment(previous['路线段']),nextSegment:positiveSegment(next['路线段']),from,to});
    if(!from||!to||!from.id||!to.id||!from.name||!to.name||!validPoint(from.point)||!validPoint(to.point)){
      issue('invalid-endpoint','真实交通段的节点身份、名称或坐标不完整');continue;
    }
    const sameId=from.id===to.id,km=greatCircleKm(from.point,to.point);
    const sharedFormalEndpoint=sameId&&km>0.05&&placeIndex.has(from.id);
    if(sameId&&km>0.05&&!sharedFormalEndpoint){issue('node-coordinate-conflict',`同一交通节点编号在原始交通中相差 ${km.toFixed(3)} 公里，须修复物理节点身份，不能用零路程接续掩盖`);continue;}
    let startDate,endDate,overlappingWindow=false;
    try{
      const beforeTime=routeTime(before),afterTime=routeTime(after);
      const previousWindow={min:bounds(beforeTime.startDate).min,max:bounds(beforeTime.endDate).max};
      const nextWindow={min:bounds(afterTime.startDate).min,max:bounds(afterTime.endDate).max};
      // A route window describes possible event times, not the precise arrival
      // at every one of its nodes. Only disjoint reverse windows prove a fault.
      if(previousWindow.min>nextWindow.max){
        issue('reverse-time',`前序完整交通窗口 ${beforeTime.startDate}—${beforeTime.endDate} 晚于后序窗口 ${afterTime.startDate}—${afterTime.endDate}，须先修复真实顺序或时间证据`);continue;
      }
      overlappingWindow=previousWindow.max>=nextWindow.min;
      startDate=overlappingWindow?beforeTime.startDate:beforeTime.endDate;
      endDate=overlappingWindow?afterTime.endDate:afterTime.startDate;
    }catch(e){issue('invalid-time',e.message);continue;}
    const start=bounds(startDate),end=bounds(endDate);
    if(end.max<start.min){issue('reverse-time',`前后交通窗口逆序：${startDate} → ${endDate}，须先修复真实顺序或时间证据`);continue;}
    const existing=managed.filter(r=>anchorMatches(r,previous,next));
    if(existing.length){
      const exact=existing.filter(r=>sameEndpoint(managedEndpoint(r,'from'),from)&&sameEndpoint(managedEndpoint(r,'to'),to));
      if(exact.length){suppressed++;continue;}
      issue('managed-endpoint-conflict','既有可维护连接已绑定本次前后交通，但真实端点不匹配，须审阅既有连接而非新增重复');continue;
    }
    const incomplete=managed.filter(r=>field(r,'previousTransport','前序交通编号')===before.id&&
      field(r,'nextTransport','后序交通编号')===after.id&&
      (!positiveSegment(field(r,'previousSegment','前序路线段'))||!positiveSegment(field(r,'nextSegment','后序路线段')))&&
      sameEndpoint(managedEndpoint(r,'from'),from)&&sameEndpoint(managedEndpoint(r,'to'),to));
    if(incomplete.length){
      issue('managed-binding-incomplete','既有可维护连接的前后交通与端点一致，但缺正整数路线段号；须补齐其绑定，不重新造连接');continue;
    }
    let recordType='接驳段';
    let coLocatedIdentityLink=false;
    if(km<=0.05){
      if(!sameId){
        // A model flight and a confirmed ground visit can reuse the same city
        // centre coordinate without sharing a physical identity. Own the exact
        // missing occurrence side; do not declare an airport/city equivalence.
        if(!missingCoLocatedVisitSide(instances,from,to,previous,next,startDate,endDate,placeIndex))continue;
        coLocatedIdentityLink=true;
      }else{
        if(end.min-start.max<=86400000)continue;
        if(!placeIndex.has(from.id)||!placeIndex.has(to.id))continue;
        // Only an unresolved pair of distinct occurrences can own a long record
        // interval. A long date gap does not establish stationary residence.
        const pair=missingVisitPair(instances,{...from,placeId:from.id},{...to,placeId:to.id},previous,next,startDate,endDate);
        if(!pair)continue;
        recordType='资料间隔';
      }
    }
    const identity=[before.id,positiveSegment(previous['路线段']),from.id,from.point,after.id,positiveSegment(next['路线段']),to.id,to.point,recordType];
    const id='LINK-'+createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0,16);
    if(seen.has(id))continue;seen.add(id);
    const source=union([before.source,after.source]);
    if(!source){issue('missing-source','前后交通均缺关联正文，连接提案不能进入正式维护源');continue;}
    const countries=union([before.countries?.join('；'),after.countries?.join('；'),placeIndex.get(from.placeId||from.id)?.country,placeIndex.get(to.placeId||to.id)?.country]);
    if(!countries){issue('missing-country','真实交通及正式节点缺国家地区归属');continue;}
    let reason=recordType==='资料间隔'
      ?`前序 ${before.id} 第 ${positiveSegment(previous['路线段'])} 段到达 ${from.name}，后序 ${after.id} 第 ${positiveSegment(next['路线段'])} 段自同一原始地点离开；两次到访之间资料尚未恢复。本记录是行程结构关系，不证明原地驻留，也不是实际移动或零公里自环。`
      :`前序 ${before.id} 第 ${positiveSegment(previous['路线段'])} 段止于 ${from.name}，后序 ${after.id} 第 ${positiveSegment(next['路线段'])} 段自 ${to.name} 出发；两端必须存在接续，但中间移动的发生日期、方式、次数及实际路径尚未还原。`;
    if(sharedFormalEndpoint)reason+=`两端共用正式地点编号 ${from.id} 仅表示正式地点身份关联；原始端点分别为 ${JSON.stringify(from.point)} 与 ${JSON.stringify(to.point)}，并不重合，端点间位移尚未恢复，不能当作原地停留或零公里接续。`;
    if(coLocatedIdentityLink)reason+=`两端节点编号 ${from.id} 与 ${to.id} 不同；原始代表坐标重合或接近不证明交通节点与地面地点物理等同。本连接只补本次到访缺少的一侧精确交通引用，真实端点、方式及路程仍待还原，不确认零公里移动。`;
    if(overlappingWindow)reason+=`前后交通的原始时间窗口重叠；本连接保留可能发生范围 ${startDate}—${endDate}，不把整条路线的结束日当作该端点的精确到达日。`;
    const row=Object.fromEntries(GROUND_HEADERS.map(key=>[key,'']));
    Object.assign(row,{'交通编号':id,'日期或区间':startDate===endDate?startDate:`${startDate}—${endDate}`,
      '日期精度':startDate===endDate?(startDate.length===10?'日':startDate.length===7?'月':'年'):'区间',
      '开始日期':startDate,'结束日期':endDate,'时间精度':startDate===endDate?(startDate.length===10?'日':startDate.length===7?'月':'年'):'区间',
      '交通方式':'交通方式待定','途经节点':`${from.name}；${to.name}`,'坐标序列纬经':JSON.stringify([from.point,to.point]),
      '国家地区':countries,'发生状态':'待还原','发生依据':reason,'关联正文':source,'分享纳入':'纳入','记录类型':recordType,
      '节点编号序列':`${from.id}；${to.id}`,'前序交通编号':before.id,'后序交通编号':after.id,
      '前序路线段':positiveSegment(previous['路线段']),'后序路线段':positiveSegment(next['路线段']),
      '里程类型':'unknown','时长类型':'unknown','线形类型':recordType==='资料间隔'?'unknown':'display','计程纳入':'否',
      '核定结论':'待核','核定方式':'证据复核','证据引用':union([sourceRef(before),sourceRef(after),...split(source).map(s=>`正文:${s}`)]),
      '核定记录':`复核对象仅为前后原始交通段与端点引用的结构完整性。${reason}日期保留两侧交通限定窗口，不确认具体发生日；不新增交通方式、公里或时长，不反向核定地面旅游。`,
      '备注':recordType==='资料间隔'?'行程控制关系；不进入普通地图路线、移动次数、里程和时长':'必要连接待还原；展示端点关系，不确认已恢复历史路径'});
    if(placeIndex.has(from.id)&&placeIndex.has(to.id))row['地点编号序列']=row['节点编号序列'];
    rows.push(row);
  }
  return {rows,issues,summary:{ordinaryRoutes:routes.length,ordinaryLegs:trajectory.length,
    connections:rows.filter(r=>r['记录类型']==='接驳段').length,recordIntervals:rows.filter(r=>r['记录类型']==='资料间隔').length,
    sharedFormalEndpointLinks:rows.filter(r=>r['记录类型']==='接驳段'&&split(r['节点编号序列'])[0]===split(r['节点编号序列'])[1]).length,
    coLocatedIdentityLinks:rows.filter(r=>r['发生依据'].includes('原始代表坐标重合或接近')).length,
    managedSuppressed:suppressed,issues:issues.length}};
}
