import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { JOURNEYS, JOURNEY_HEADERS, TRAJECTORY, TRAJECTORY_HEADERS } from './schema.mjs';

export { JOURNEYS, JOURNEY_HEADERS, TRAJECTORY, TRAJECTORY_HEADERS } from './schema.mjs';
export const TIME_HEADERS=['开始日期','结束日期','时间精度','段序'];
const sourceDateKeys=value=>{
  const text=String(value||''),dates=text.match(/\d{4}(?:-\d{2}(?:-\d{2})?)?/g)||[];
  let end=dates.at(-1)||'';
  const shortMonth=text.match(/^(\d{4})-(\d{2})\s*[—–]\s*(\d{2})$/);
  const shortDay=text.match(/^(\d{4}-\d{2})-\d{2}\s*[—–]\s*(\d{2})$/);
  if(shortMonth)end=shortMonth[1]+'-'+shortMonth[3];
  if(shortDay)end=shortDay[1]+'-'+shortDay[2];
  return {start:dates[0]||'',end};
};
export function routeTime(row){
  const dates=sourceDateKeys(row['日期或区间']||row.date);
  const start=row['开始日期']||row.startDate||dates.start,end=row['结束日期']||row.endDate||dates.end||start;
  for(const d of [start,end]){
    if(!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(d))throw new Error('时间键须为年、年月或日期：'+d);
    const [y,m,day]=d.split('-').map(Number);
    if(m!==undefined&&(m<1||m>12)||day!==undefined&&(day<1||day>new Date(Date.UTC(y,m,0)).getUTCDate()))throw new Error('时间键日期无效：'+d);
  }
  const startBounds=dateBounds(start),endBounds=dateBounds(end);
  if(startBounds&&endBounds&&endBounds.end<startBounds.start)throw new Error('结束日期早于开始日期');
  const precision=start!==end?'区间':start.length===10?'日':start.length===7?'月':'年';
  const sequence=row['段序']??row.sequence;
  if(sequence!==undefined&&sequence!==null&&sequence!==''&&(!Number.isInteger(Number(sequence))||Number(sequence)<1))throw new Error('段序须为正整数');
  return {startDate:start,endDate:end,timePrecision:row['时间精度']||row.timePrecision||precision,sequence:sequence===''||sequence===undefined||sequence===null?null:Number(sequence)};
}

// Great-circle distance in km; kept local so the layer modules stay free of cycles.
export function greatCircleKm([lat1,lon1],[lat2,lon2]){
  const rad=v=>v*Math.PI/180,h=Math.sin((rad(lat2)-rad(lat1))/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin((rad(lon2)-rad(lon1))/2)**2;
  return 6371.0088*2*Math.asin(Math.sqrt(Math.min(1,h)));
}

// Store and distribute integer metres; kilometres are a display/compatibility value.
export function allocateMeters(total,weights){
  const n=weights.length,whole=Math.round(total),sum=weights.reduce((s,w)=>s+w,0);
  if(!n)return [];
  if(!Number.isSafeInteger(whole)||whole<n||weights.some(w=>!Number.isFinite(w)||w<0))throw new Error('路线总米数须足够分配正整数米段，且权重须有效');
  const exact=weights.map(w=>sum?whole*w/sum:whole/n),out=exact.map(v=>Math.max(1,Math.floor(v)));
  let rest=whole-out.reduce((s,v)=>s+v,0);
  const order=exact.map((v,i)=>[v-Math.floor(v),i]).sort((a,b)=>b[0]-a[0]).map(x=>x[1]);
  for(let k=0;rest>0;k=(k+1)%n){out[order[k]]++;rest--;}
  for(let k=0;rest<0;k=(k+1)%n){if(out[order[k]]>1){out[order[k]]--;rest++;}}
  return out;
}

export const allocateKm=(total,weights)=>allocateMeters(total*1000,weights).map(m=>m/1000);

const dateKey=value=>{const m=String(value).match(/(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);return m?[+m[1],+(m[2]||1),+(m[3]||1)]:[9999,99,99];};
const dateGapDays=(a,b)=>{
  const [ay,am,ad]=dateKey(a),[by,bm,bd]=dateKey(b);
  if(!Number.isFinite(ay)||!Number.isFinite(by)||ay>9000||by>9000)return null;
  return Math.round((Date.UTC(by,bm-1,bd)-Date.UTC(ay,am-1,ad))/86400000);
};
const before=(a,b)=>a[0]!==b[0]?a[0]<b[0]:a[1]!==b[1]?a[1]<b[1]:a[2]<b[2];
const key=value=>dateKey(value).join('-');

// Airport/transport nodes retain their source facts while exposing a bound
// city layer for visual geometry. Display geometry never proves continuity.
export const routePoints=r=>r.displayPoints||r.points;
export const routeNames=r=>r.displayNames||r.names;

// 节点归一：航空档案自带“机场归并名 → 服务城市”，用它把 东京成田→东京、
// 大阪关西→大阪、上海浦东→上海 这类同城节点合并。别名由既有审核数据派生，
// 不新增需要手工维护的表；后续换机场只改航空表即可。
export function nodeAliases(records){
  const map=new Map();
  for(const r of records){
    if(!Array.isArray(r.cities))continue;
    r.names.forEach((name,i)=>{
      const city=r.cities[i];
      if(name&&city&&name!==city&&!map.has(name))map.set(name,city);
    });
  }
  return map;
}

export const canonicalName=(name,aliases)=>{
  if(!aliases?.size)return name;
  // Display labels may carry an original-language suffix, e.g. “蒙特朗布朗（Mont-Tremblant）”.
  // Remove that presentation-only suffix before applying the shared city alias map;
  // otherwise a renamed place would create a false hub link or trajectory break.
  let out=String(name||'').replace(/[（(][^（）()]*[）)]$/,'').trim();
  for(let i=0;i<8;i++){const next=aliases.get(out);if(!next||next===out)break;out=next;}
  return out;
};

// 简称归一到全称：白马 ⊂ 白马村、克雷姆斯 ⊂ 多瑙河畔克雷姆斯。只在
// 唯一命中时成立；多义（同时匹配多个地点）不猜测，留给人工核实。
export function makeNameResolver(places){
  const byCountryName=new Map(),unique=new Map(),contains=new Map();
  for(const p of places){
    byCountryName.set(p.country+'|'+p.name,p);
    unique.set(p.name,unique.has(p.name)?null:p);
    for(const n of new Set([p.name,...(p.altNames||[])])){
      if(!contains.has(n))contains.set(n,new Set());
      contains.get(n).add(p);
    }
  }
  const resolve=(name,country)=>{
    if(!name)return null;
    const exact=byCountryName.get((country||'')+'|'+name)||unique.get(name);
    if(exact)return exact;
    const hits=new Set();
    for(const [n,set] of contains){
      if(n.length>=2&&(n.includes(name)||name.includes(n)))for(const p of set)hits.add(p);
    }
    return hits.size===1?[...hits][0]:null;
  };
  return {resolve,byCountryName,unique};
}

// Physical endpoint identity, not a shared city name, proves continuity.
// Fifty metres tolerates coordinate rounding without swallowing an airport,
// station or in-city transfer. Node identity conflicts remain visible.
export function joinsChain(from,to,{nearKm=0.05}={}){
  const km=greatCircleKm([from.lat,from.lon],to.point);
  if(km<=Math.min(nearKm,0.05))return {km,joined:true,reason:from.nodeId&&from.nodeId===to.nodeId?'同一节点编号与实地点':'原始端点重合'};
  return {km,joined:false,reason:from.nodeId&&from.nodeId===to.nodeId?'同一节点编号的坐标不一致':''};
}

const isGapControl=r=>r.recordType==='资料间隔';
const isAnchoredTransfer=r=>['接驳段','节点对应'].includes(r.recordType);
const isUnrestored=r=>r.structuralLink===true||r.candidate===true||isGapControl(r)||
  (r.recordType==='接驳段'&&r.countDistance===false&&['交通方式待定','地面交通待定','资料间隔','待定'].includes(r.mode));
const asControlConnector=r=>({...r,from:r.from||r.points?.[0],to:r.to||r.points?.at(-1),
  fromName:r.fromName||r.names?.[0],toName:r.toName||r.names?.at(-1),
  fromNodeId:r.fromNodeId||r.nodeIds?.[0],toNodeId:r.toNodeId||r.nodeIds?.at(-1),
  fromPlaceId:r.fromPlaceId||r.nodePlaceIds?.[0],toPlaceId:r.toPlaceId||r.nodePlaceIds?.at(-1),
  previousSegment:r.previousSegment||null,nextSegment:r.nextSegment||null,candidate:true,countDistance:false});

// A continuous city-to-city chain: every route is cut at its nodes, ordered by date,
// re-linked within the same day by endpoint proximity, and checked for a real
// endpoint join. Discontinuities stay visible instead of being bridged by an
// invented leg.
export function trajectoryRows(routes,journeys,{aliases,connectors=[],scope='global',allowStaleBindings=false}={}){
  const movementRoutes=routes.filter(r=>!isUnrestored(r));
  connectors=[...new Map([...routes.filter(isUnrestored).map(asControlConnector),...connectors].map(c=>[c.id,c])).values()];
  const place=new Map(),dependencies=new Map(),connectorDependencies=new Map(),ordinary=movementRoutes.filter(r=>!isAnchoredTransfer(r));
  journeys.forEach((j,ji)=>{
    const registered=orderLegs(j.transport.filter(r=>!isUnrestored(r)&&r.include!==false),aliases);
    registered.forEach((r,ti)=>{if(isAnchoredTransfer(r))place.set(r.id,{journey:j,ji,ti});});
    const rs=registered.filter(r=>!isAnchoredTransfer(r));
    rs.forEach((r,ti)=>{
      place.set(r.id,{journey:j,ji,ti,orderBasis:r.orderBasis,orderIssues:r.orderIssues||[]});
      if(ti)dependencies.set(r.id,rs[ti-1].id);
    });
  });
  for(const r of movementRoutes.filter(isAnchoredTransfer)){
    if(allowStaleBindings)continue;
    // Branch insertion is segment-level: A→B→A inside one trunk cannot create
    // whole-route dependencies in both directions.
    if(place.get(r.previousTransport)?.ji===place.get(r.nextTransport)?.ji)continue;
    if(!connectorDependencies.has(r.nextTransport))connectorDependencies.set(r.nextTransport,new Set());
    connectorDependencies.get(r.nextTransport).add(r.previousTransport);
  }
  const waiting=ordinary.map((r,i)=>({r,...(place.get(r.id)||{ji:9999,ti:i,orderBasis:r.sequence!==null&&r.sequence!==undefined?'显式段序':'时间与端点推定',orderIssues:[]})}));
  const ordered=[],emitted=new Set();
  while(waiting.length){
    const knownOrEmitted=id=>emitted.has(id)||!ordinary.some(r=>r.id===id);
    const ready=waiting.filter(e=>(!dependencies.has(e.r.id)||knownOrEmitted(dependencies.get(e.r.id)))&&
      [...(connectorDependencies.get(e.r.id)||[])].every(knownOrEmitted));
    ready.sort((a,b)=>{
      const ka=dateKey(routeTime(a.r).startDate),kb=dateKey(routeTime(b.r).startDate);
      if(before(ka,kb))return -1;if(before(kb,ka))return 1;
      if(Number.isFinite(a.r.scheduledStart)!==Number.isFinite(b.r.scheduledStart))return Number(!Number.isFinite(a.r.scheduledStart))-Number(!Number.isFinite(b.r.scheduledStart));
      return a.ji-b.ji||(a.r.sequence??a.ti)-(b.r.sequence??b.ti);
    });
    const entry=ready[0];if(!entry)throw new Error('交通顺序依赖循环');
    waiting.splice(waiting.indexOf(entry),1);ordered.push(entry);emitted.add(entry.r.id);
  }
  const chain=[];
  for(let i=0;i<ordered.length;){
    const time=routeTime(ordered[i].r),window=time.startDate,group=[];
    while(i<ordered.length){
      const t=routeTime(ordered[i].r);if(t.startDate!==window)break;
      const entry=ordered[i++];
      for(let k=1;k<entry.r.points.length;k++)group.push({...entry,i:k,from:entry.r.points[k-1],to:entry.r.points[k],fromName:entry.r.names[k-1],toName:entry.r.names[k]});
    }
    // Never let a second geometry pass undo an explicit sequence or a valid
    // registered route order. Unknown ordering can still infer a branch visit.
    const protectedOrder=group.some(e=>['显式段序','登记顺序','部分段序与时间登记','前后交通绑定','跨行程交通绑定'].includes(e.orderBasis));
    let anchor=chain.at(-1)||null;
    while(group.length){
      const ready=c=>!group.some(o=>o!==c&&o.r.id===c.r.id&&o.i<c.i);
      let chosen=group.find(ready);
      if(!protectedOrder){
        const available=group.filter(ready);
        // When a local transfer is absent, start the remaining connected
        // component at its entry, not at the first row of a reverse export.
        // Otherwise A→home can precede B→A and manufacture a home→B gap.
        const roots=available.filter(c=>!available.some(o=>o!==c&&!isLoopRoute(o.r)&&segmentOrderJoin(o,c,aliases)));
        const containsBranch=c=>group.filter(o=>o.i===1&&o.r.id!==c.r.id&&isLoopRoute(o.r)&&c.r.points.slice(1,-1).some((p,k)=>
          orderEndpointJoin(p,c.r.names[k+1],c.r.nodeIds?.[k+1],o.from,o.fromName,o.r.nodeIds?.[0],aliases))).length;
        chosen=roots.sort((a,b)=>containsBranch(b)-containsBranch(a)||a.ti-b.ti)[0]||chosen;
        if(anchor){
          const connected=available.filter(c=>segmentOrderJoin(anchor,c,aliases));
          if(connected.length)chosen=connected.sort((a,b)=>Number(!isLoopRoute(a.r))-Number(!isLoopRoute(b.r))||
            Number(a.r.id===anchor.r.id)-Number(b.r.id===anchor.r.id)||containsBranch(b)-containsBranch(a)||a.ti-b.ti||a.i-b.i)[0];
        }else{
          chosen=roots.sort((a,b)=>containsBranch(b)-containsBranch(a)||a.ti-b.ti)[0]||chosen;
        }
      }
      group.splice(group.indexOf(chosen),1);chain.push(chosen);anchor=chosen;
    }
  }
  // Bind after branch traversal, to exact segment occurrences. Inserting into
  // whole routes first would undo a day trip nested inside a multi-stop trunk.
  for(const r of movementRoutes.filter(isAnchoredTransfer)){
    const next=chain.findIndex(e=>e.r.id===r.nextTransport&&e.i===Number(r.nextSegment||1));
    const prior=chain.findIndex(e=>e.r.id===r.previousTransport&&e.i===Number(r.previousSegment||e.r.points.length-1));
    if(next<0||prior<0){
      if(scope!=='journey')throw new Error('接驳前后交通不存在：'+r.id);
    }else if(prior>=next){if(allowStaleBindings)continue;throw new Error('接驳前后交通次序冲突：'+r.id);}
    const at=next>=0?next:prior>=0?prior+1:chain.length,near=chain[next>=0?next:prior];
    chain.splice(at,0,{r,...(place.get(r.id)||{ji:near?.ji??9999,ti:near?.ti??at}),i:1,
      from:r.points[0],to:r.points[1],fromName:r.names[0],toName:r.names[1],
      orderBasis:next<0||prior<0?'跨行程交通绑定':'前后交通绑定',orderIssues:[],externalBinding:next<0||prior<0});
  }
  const rows=[];let previous=null;
  // A warning belongs to the maintained transport record, not every
  // geometry segment derived from that record. Keep it on the first segment
  // so summaries describe records rather than repeated line fragments.
  const shownOrderIssues=new Set();
  const managedIssuePairs=new Set(connectors.filter(isUnrestored).map(c=>`${c.previousTransport} → ${c.nextTransport}`));
  const distanceCache=new Map();
  for(const leg of chain){
    const r=leg.r,i=leg.i,journey=leg.journey,time=routeTime(r);
    const unresolved=isUnrestored(r),external=leg.externalBinding===true;
    if(!distanceCache.has(r.id)){
      const factPoints=r.points;
      const weights=factPoints.slice(1).map((p,k)=>greatCircleKm(factPoints[k],p));
      distanceCache.set(r.id,{meters:unresolved||r.countDistance===false||r.km===null||r.km===undefined?[]:allocateMeters(r.km*1000,weights),
        basis:factPoints.length===2?r.distanceBasis:r.distanceModel?r.distanceBasis:`按整条路线 ${r.km} 公里与各段大圆距离比例拆分（合理推算）`});
    }
    const {meters,basis}=distanceCache.get(r.id),from=r.points[i-1],to=r.points[i],names=r.names;
    const segment=`${i}/${r.points.length-1}`;
    let join=previous?joinsChain(previous,{point:from,name:names[i-1],nodeId:r.nodeIds?.[i-1]}):null;
    const currentBounds=routeDateBounds(r),previousBounds=previous?.bounds;
    // A route interval may overlap the prior interval. Comparing only its
    // start with the previous end fabricates order contradictions for coarse
    // historical windows; only completely disjoint reversed windows prove one.
    const timeIssue=previousBounds&&currentBounds&&currentBounds.end<previousBounds.start?'时间逆序':'';
    const elapsed=previous?dateGapDays(previous.endDate,time.startDate):null;
    let pendingJoin=previous?.unrestored?previous.transport:null,externalJoin=previous?.externalBinding===true;
    if(previous&&join){
      const matches=connectors.filter(c=>c.previousTransport===previous.transport&&c.nextTransport===r.id&&segmentNumber(c.previousSegment)===segmentNumber(previous.segment)&&segmentNumber(c.nextSegment)===i);
      if(matches.length>1)throw new Error('同一交通段接续重复：'+previous.transport+' / '+r.id);
      if(matches.length){
        const c=matches[0],covered=false,candidate=isUnrestored(c);
        // A counted segment must occur at its real position in this chain.
        // Reusing even an exact earlier segment reference is still teleporting.
        if(c.covered)throw new Error('链内已覆盖须恢复真实交通段顺序，不能代替缺失移动：'+c.id);
        if(candidate&&joinsChain(previous,{point:c.from,nodeId:c.fromNodeId}).joined&&joinsChain({lat:c.to[0],lon:c.to[1],nodeId:c.toNodeId},{point:from,nodeId:r.nodeIds?.[i-1]}).joined)pendingJoin=c.id;
        rows.push({'轨迹序号':rows.length+1,'日期':c.date||`${c.startDate||previous.endDate} — ${c.endDate||time.startDate}`,'出发地':c.fromName,'到达地':c.toName,
          '出发节点编号':c.fromNodeId||previous.nodeId||'','到达节点编号':c.toNodeId||r.nodeIds?.[i-1]||'',
          '出发地点编号':c.fromPlaceId||'','到达地点编号':c.toPlaceId||'',
          '开始日期':c.startDate||previous.endDate,'结束日期':c.endDate||time.startDate,'时间精度':c.timePrecision||'区间',
          '出发纬度':c.from[0],'出发经度':c.from[1],'到达纬度':c.to[0],'到达经度':c.to[1],'交通方式':c.mode,
          '里程米':covered||candidate||c.km==null?'':Math.round(c.km*1000),'里程公里':covered||candidate||c.km==null?'':c.km,'里程依据':c.basis,
          '计程纳入':covered||candidate||c.countDistance===false?'否':'是','发生状态':candidate?'待还原':covered?'链内已覆盖':c.status||'合理推定',
          '接续状态':candidate?'待核':'连续','接续类型':candidate?(isGapControl(c)?'资料间隔':'待还原接续'):covered?'链内已覆盖':'枢纽接驳',
          '排序依据':'前后交通段绑定','排序问题':timeIssue,
          '接续说明':c.evidence,'所属行程编号':'','所属行程名称':'','交通编号':c.id,'路线段':'接驳','关联正文':c.source});
        if(!candidate){
          previous={...previous,lat:c.to[0],lon:c.to[1],name:c.toName,nodeId:c.toNodeId};
          join=joinsChain(previous,{point:from,name:names[i-1],nodeId:r.nodeIds?.[i-1]});
        }
      }
    }
      const continuous=join?join.joined&&!timeIssue&&!pendingJoin&&!externalJoin&&!unresolved&&!external:null;
      const boundary=join&&!join.joined&&elapsed!==null&&elapsed>2;
      const routeIssues=[...(shownOrderIssues.has(r.id)?[]:leg.orderIssues||[]),timeIssue].filter(Boolean)
        .filter(issue=>!(issue.startsWith('登记端点未接续：')&&managedIssuePairs.has(issue.slice('登记端点未接续：'.length))));
      shownOrderIssues.add(r.id);
      rows.push({'轨迹序号':rows.length+1,'日期':r.date,'出发地':names[i-1],'到达地':names[i],
        '出发节点编号':r.nodeIds?.[i-1]||'','到达节点编号':r.nodeIds?.[i]||'',
        '出发地点编号':r.nodePlaceIds?.[i-1]||'','到达地点编号':r.nodePlaceIds?.[i]||'',
        '开始日期':time.startDate,'结束日期':time.endDate,'时间精度':time.timePrecision,
        '排序依据':leg.orderBasis||'时间与端点推定','排序问题':[...new Set(routeIssues)].join('；'),
        '出发纬度':from[0],'出发经度':from[1],'到达纬度':to[0],'到达经度':to[1],'交通方式':r.mode,
        '里程米':meters.length?meters[i-1]:'','里程公里':meters.length?meters[i-1]/1000:'','里程依据':meters.length?basis:unresolved?'必要移动尚未还原，不计程':r.countDistance===false?'已登记不计程':'整条路线公里未核',
        '计程纳入':unresolved||r.countDistance===false?'否':'是',
        '发生状态':unresolved?'待还原':r.status,'接续状态':timeIssue?'断点':unresolved?'待核':external||externalJoin?'待接续':continuous===null?'链条起点':continuous?'连续':pendingJoin?'待还原':'断点',
        '接续类型':unresolved?'待还原接续':external||externalJoin?'跨行程边界待核':pendingJoin?'接续待还原':r.recordType==='接驳段'?'枢纽接驳':boundary?'时间边界':'旅行',
        '接续说明':timeIssue?`前后交通日期区间逆序：${previous.endDate} → ${time.startDate}`:unresolved?`结构连接 ${r.id} 表示必要但尚未还原的移动，不能证明历史路径连续`:external||externalJoin?'局部行程没有完整前后交通，须在全局轨迹核对':continuous===null?'本人行程链的最早记录':continuous&&join?.reason?join.reason:pendingJoin?`必要移动由候选 ${pendingJoin} 管理，发生细节与路径待还原`:`上一段止于 ${previous.name}，与 ${names[i-1]} 相距约 ${Math.round(join.km)} 公里，中间移动未记录${boundary?`；记录间隔 ${elapsed} 天，不能以时间边界证明接续`:''}`,
        '所属行程编号':journey?.id||'' ,'所属行程名称':journey?.name||'','交通编号':r.id,
        '路线段':segment,'关联正文':r.source});
      previous={lat:to[0],lon:to[1],name:names[i],nodeId:r.nodeIds?.[i],status:r.status,date:r.date,endDate:time.endDate,bounds:currentBounds,transport:r.id,segment,
        unrestored:unresolved,externalBinding:external};
  }
  return rows;
}

const segmentNumber=value=>Number(String(value??'').split('/')[0]);
const segmentJoins=(a,b)=>joinsChain({lat:a.to[0],lon:a.to[1],name:a.toName,nodeId:a.r.nodeIds?.[a.i]},
  {point:b.from,name:b.fromName,nodeId:b.r.nodeIds?.[b.i-1]});
// Logical identity may determine where a day-trip branches from its trunk.
// This does NOT certify physical continuity or erase the actual transfer.
const orderEndpointJoin=(a,an,aid,b,bn,bid,aliases)=>Boolean(aid&&aid===bid)||
  canonicalName(an,aliases)===canonicalName(bn,aliases)&&greatCircleKm(a,b)<
    (an!==bn&&(aliases?.has(an)||aliases?.has(bn))?150:30)||greatCircleKm(a,b)<2;
const segmentOrderJoin=(a,b,aliases)=>segmentJoins(a,b).joined||
  orderEndpointJoin(a.to,a.toName,a.r.nodeIds?.[a.i],b.from,b.fromName,b.r.nodeIds?.[b.i-1],aliases);

const rowMeters=r=>r['计程纳入']==='否'?0:r['里程米']===undefined?Math.round((Number(r['里程公里'])||0)*1000):(Number(r['里程米'])||0);
const missingMeasure=r=>r['里程公里']===''||r['里程公里']===null||r['里程公里']===undefined;
export const trajectorySummary=rows=>({legs:rows.length,joined:rows.filter(r=>r['接续状态']==='连续').length,
  // A long recording gap is an unresolved transition, not continuity proof.
  breaks:rows.filter(r=>r['接续状态']==='断点').length,
  timeBoundaries:rows.filter(r=>r['接续类型']==='时间边界').length,
  hardBreaks:rows.filter(r=>r['接续状态']==='断点').length,
  pendingConnectors:rows.filter(r=>['待还原接续','资料间隔'].includes(r['接续类型'])).length,
  unrestoredTransitions:rows.filter(r=>r['接续状态']==='待还原').length,
  orderIssues:new Set(rows.flatMap(r=>String(r['排序问题']||'').split('；').filter(Boolean))).size,
  orderIssueRows:rows.filter(r=>r['排序问题']).length,
  hubLinks:rows.filter(r=>r['接续类型']==='枢纽接驳').length,
  coveredLinks:rows.filter(r=>r['接续类型']==='链内已覆盖').length,
  hubKm:rows.filter(r=>r['接续类型']==='枢纽接驳').reduce((s,r)=>s+rowMeters(r),0)/1000,
  meters:rows.reduce((s,r)=>s+rowMeters(r),0),
  km:rows.reduce((s,r)=>s+rowMeters(r),0)/1000,
  // Unmeasured, explicitly non-counting relations are not missing mileage.
  // Their restoration state remains visible in the separate connector fields.
  nonCountingLegs:rows.filter(r=>r['计程纳入']==='否').length,
  unmeasuredNonCountingLegs:rows.filter(r=>r['计程纳入']==='否'&&missingMeasure(r)).length,
  missingKm:rows.filter(r=>r['计程纳入']!=='否'&&missingMeasure(r)).length});

export function locationLayer(japan,regional){
  const places=[...japan.map(p=>({...p,country:'日本',countryCode:'JP',unitId:'JP-'+p.prefectureId,include:p.include??true,table:'japanPlaces'})),...regional.map(p=>({...p,table:'regionPlaces'}))];
  const index=new Map();
  for(const p of places){
    p.level=p.level||(p.status==='途经/机场'?'交通节点':'城市/城镇');
    if(!['城市/城镇','景区','交通节点','行政区'].includes(p.level))throw new Error('节点级别无效：'+p.id);
    if(index.has(p.id))throw new Error('跨表地点编号重复：'+p.id);index.set(p.id,p);
  }
  for(const p of places)if(p.parentId){
    const parent=index.get(p.parentId);
    if(!parent||parent.id===p.id||parent.country!==p.country)throw new Error('上级节点不存在、自引用或跨国：'+p.id);
    const seen=new Set([p.id]);let cur=parent;
    while(cur){if(seen.has(cur.id))throw new Error('上级节点循环：'+p.id);seen.add(cur.id);cur=index.get(cur.parentId);}
  }
  // 名称索引：国家+地名优先，其后唯一同名、最后唯一包含匹配（简称归一）。
  const resolver=makeNameResolver(places);
  return {places,index,byName:resolver.byCountryName,uniqueByName:resolver.unique,resolveName:resolver.resolve,
    summary:{records:places.length,confirmed:places.filter(p=>p.status==='已到访').length,
    candidates:places.filter(p=>p.status==='待核').length,transit:places.filter(p=>p.status==='途经/机场').length,planned:places.filter(p=>p.status==='计划').length}};
}

// Used only by the one-time cutover; it preserves grouping without asserting
// that a source document is a fully confirmed chronological journey.
export function seedJourneys(records,places){
  const groups=new Map();
  for(const [inputIndex,r] of records.entries()){
    const source=(r.source||'').split('；')[0],id=r.journeyId||'J-'+createHash('sha256').update(source||r.id).digest('hex').slice(0,12);
    if(!groups.has(id))groups.set(id,[]);groups.get(id).push({...r,__inputIndex:inputIndex});
  }
  return [...groups].map(([id,rs])=>{
    // Prefer explicit segment order, then source date, then the stable source
    // order.  A generic loader must never contain a person's route IDs or
    // silently reorder a branch by a hand-maintained special case.
    rs.sort((a,b)=>{
      const sa=Number(a.sequence??a['段序']),sb=Number(b.sequence??b['段序']);
      const hasA=Number.isFinite(sa)&&sa>0,hasB=Number.isFinite(sb)&&sb>0;
      if(hasA!==hasB)return hasA?-1:1;
      if(hasA&&sa!==sb)return sa-sb;
      const da=String(a.date||a['日期或区间']||''),db=String(b.date||b['日期或区间']||'');
      return da.localeCompare(db)||a.__inputIndex-b.__inputIndex;
    });
    const base=rs.find(r=>r.base)?.base||'',source=rs.find(r=>r.source)?.source||'';
    const matches=places.filter(p=>p.name===base&&rs.some(r=>r.countries.includes(p.country)));
    const suppliedStatus=rs.find(r=>r.journeyStatus||r['重构状态'])?.journeyStatus||rs.find(r=>r['重构状态'])?.['重构状态'];
    const suppliedBasis=rs.map(r=>r.evidence||r['发生依据']).filter(Boolean).join('；');
    return {'行程编号':id,'行程名称':rs.find(r=>r.journeyName)?.journeyName||basename(source,'.md').replace(/^\d{4}-[^_]+_/,'' )||rs[0].names.join('—'),
      '出发基地地点编号':matches.length===1?matches[0].id:'','出发基地':base,
      '日期或区间':rs[0].date===rs.at(-1).date?rs[0].date:rs[0].date+' — '+rs.at(-1).date,'日期精度':'沿用交通记录精度，不补具体日',
      '重构状态':suppliedStatus||'来源归组',
      '行程依据':suppliedBasis||'按既有来源归组，实际经历与推测以组成交通记录为准',
      '关联交通编号':rs.map(r=>r.id).join('；'),'关联正文':[...new Set(rs.map(r=>r.source).filter(Boolean))].join('；')||'source-not-specified',
      '分享纳入':rs.some(r=>r.include)?'纳入':'排除','备注':'地点、交通记录及原审核值不变；路线片段顺序可持续核定，缺口不自动补线'};
  });
}

export function journeyLayer(rows,records,locations,{validateDates=true}={}){
  const recordIndex=new Map(),ids=new Set(),owners=new Map();
  for(const r of records){if(recordIndex.has(r.id))throw new Error('跨表交通编号重复：'+r.id);recordIndex.set(r.id,r);}
  const journeys=rows.map(row=>{
    const id=row['行程编号'];if(!id||ids.has(id))throw new Error('行程编号为空或重复：'+id);ids.add(id);
    if(!row['行程名称']||!row['行程依据']||!row['关联正文'])throw new Error('行程缺名称、依据或正文：'+id);
    if(!['本人确认','合理重构','来源归组','计划','待核'].includes(row['重构状态']))throw new Error('行程重构状态无效：'+id);
    if(!['纳入','排除'].includes(row['分享纳入']))throw new Error('行程分享纳入无效：'+id);
    if(row['行程形态']&&!['往返','开放接续'].includes(row['行程形态']))throw new Error('行程形态须为往返或开放接续：'+id);
    if(row['行程形态']==='开放接续'&&!row['闭环依据'])throw new Error('开放接续必须有闭环依据：'+id);
    const baseId=row['出发基地地点编号']||'',base=baseId?locations.index.get(baseId):null;
    if(baseId&&!base)throw new Error('行程基地地点不存在：'+id+' / '+baseId);
    const refs=(row['关联交通编号']||'').split('；').filter(Boolean);
    if(!refs.length&&row['分享纳入']==='纳入')throw new Error('行程缺关联交通：'+id);
    const transport=refs.map((ref,registrationIndex)=>{
      if(!recordIndex.has(ref))throw new Error('行程关联交通不存在：'+id+' / '+ref);
      if(owners.has(ref))throw new Error('同一交通只能属于一个行程：'+ref+' / '+owners.get(ref)+' / '+id);
      owners.set(ref,id);return {...recordIndex.get(ref),registrationIndex};
    });
    return {id,name:row['行程名称'],baseId,base:base?.name||row['出发基地']||'',date:row['日期或区间'],precision:row['日期精度'],
      status:row['重构状态'],evidence:row['行程依据'],source:row['关联正文'],include:row['分享纳入']==='纳入',closureGroup:row['闭环组编号']||'',shape:row['行程形态']||'',closureBasis:row['闭环依据']||'',transportIds:refs,transport};
  });
  const dateViolations=journeyDateViolations(journeys);
  if(validateDates&&dateViolations.length){
    const sample=dateViolations.slice(0,5).map(v=>`${v.transport}(${v.date})→${v.journey}[${v.scope}]`).join('；');
    throw new Error(`交通日期超出行程范围：${sample}${dateViolations.length>5?'……':''}`);
  }
  // New archived tickets remain visible before grouping, and enter the queue.
  const unassigned=records.filter(r=>r.include&&!owners.has(r.id));
  const journeyIndex=new Map(journeys.map(j=>[j.id,j]));
  for(const j of journeys)j.transport=j.transport.map(r=>({...r,journeyId:j.id,journeyName:j.name}));
  const routes=records.filter(r=>r.include&&(!owners.has(r.id)||journeyIndex.get(owners.get(r.id)).include)).map(r=>({...r,journeyId:owners.get(r.id)||'',journeyName:journeyIndex.get(owners.get(r.id))?.name||''}));
  return {journeys,routes,unassigned,owners,aliases:nodeAliases(records),locations,
    summary:{records:records.length,journeys:journeys.length,sharedJourneys:journeys.filter(j=>j.include).length,
    unassigned:unassigned.length,linkedRoutes:records.filter(r=>r.nodePlaceIds?.some(Boolean)).length}};
}

// 端点衔接判断，统一走 joinsChain（含机场/车站同城归一）。
const legsJoin=(a,b,aliases)=>{
  const from=a.points.at(-1),to=b.points[0];
  return joinsChain({lat:from[0],lon:from[1],name:a.names.at(-1),nodeId:a.nodeIds?.at(-1)},
    {point:to,name:b.names[0],nodeId:b.nodeIds?.[0]}).joined;
};
const isLoopRoute=r=>r.points.length>1&&joinsChain({lat:r.points[0][0],lon:r.points[0][1],nodeId:r.nodeIds?.[0]},
  {point:r.points.at(-1),nodeId:r.nodeIds?.at(-1)}).joined;
const isChain=(legs,aliases)=>{
  for(let i=1;i<legs.length;i++)if(!legsJoin(legs[i-1],legs[i],aliases))return false;
  return true;
};
const legsOrderJoin=(a,b,aliases)=>legsJoin(a,b)||
  orderEndpointJoin(a.points.at(-1),a.names.at(-1),a.nodeIds?.at(-1),b.points[0],b.names[0],b.nodeIds?.[0],aliases);

// 维护表里已登记的次序优先：它连贯时保持原样（例如已登记的分支往返把
// A→B、B→C、B→D、B→A按实际顺序登记）。
// 只有登记次序本身不连贯时才按日期重排，并在同日多段间按端点接力，
// 避免把“A→B→C”误读成“C→A”。
export function orderLegs(legs,aliases){
  if(!legs.length)return [];
  const issues=rs=>rs.flatMap((r,i)=>{
    if(!i)return [];
    const prior=rs[i-1],a=routeDateBounds(prior),b=routeDateBounds(r),out=[];
    if(a&&b&&b.end<a.start)out.push(`日期次序冲突：${prior.id} → ${r.id}`);
    if(Number.isFinite(prior.scheduledStart)&&Number.isFinite(r.scheduledStart)&&prior.scheduledStart>r.scheduledStart)out.push(`日期次序冲突：${prior.id} → ${r.id}`);
    if(!legsJoin(prior,r,aliases))out.push(`登记端点未接续：${prior.id} → ${r.id}`);
    return out;
  });
  const annotate=(rs,basis,orderIssues)=>rs.map(r=>({...r,orderBasis:basis,
    orderIssues:orderIssues.filter(issue=>!issue.startsWith('登记端点未接续：')&&!issue.startsWith('日期次序冲突：')||issue.endsWith(' → '+r.id))}));
  const hasSequence=r=>r.sequence!==null&&r.sequence!==undefined&&r.sequence!=='';
  const sequenced=legs.filter(hasSequence);
  const registered=[...legs].sort((a,b)=>(a.registrationIndex??legs.indexOf(a))-(b.registrationIndex??legs.indexOf(b)));
  // A maintained sequence is a fact to audit, not a hint to override. Invalid
  // sequences retain their order so their temporal/endpoint conflicts surface.
  if(sequenced.length===legs.length){
    const ordered=[...legs].sort((a,b)=>(a.sequence??Infinity)-(b.sequence??Infinity)||(a.registrationIndex??legs.indexOf(a))-(b.registrationIndex??legs.indexOf(b)));
    const sequences=ordered.map(r=>r.sequence).filter(v=>v!==null&&v!==undefined&&v!=='');
    const duplicate=sequences.length!==new Set(sequences).size;
    return annotate(ordered,'显式段序',[...issues(ordered),...(duplicate?['显式段序重复']:[])]);
  }
  if(sequenced.length){
    // Partial numbering is not a total order: an unnumbered arrival flight
    // cannot be sent behind every numbered ground leg. Keep the registered
    // timeline (or repair proven date reversals), and compare sequence values
    // only within the same time window, leaving unnumbered slots untouched.
    const ordered=issues(registered).some(s=>s.startsWith('日期'))?[...registered].sort((a,b)=>
      routeTime(a).startDate.localeCompare(routeTime(b).startDate)||(a.registrationIndex??legs.indexOf(a))-(b.registrationIndex??legs.indexOf(b))):[...registered];
    const windows=new Map(),extra=[];
    ordered.forEach((r,i)=>{
      if(!hasSequence(r))return;
      const time=routeTime(r),window=time.startDate+'|'+time.endDate+'|'+time.timePrecision;
      if(!windows.has(window))windows.set(window,[]);windows.get(window).push(i);
    });
    for(const positions of windows.values()){
      const group=positions.map(i=>ordered[i]);
      if(group.length!==new Set(group.map(r=>r.sequence)).size)extra.push('同时间窗口内显式段序重复');
      group.sort((a,b)=>a.sequence-b.sequence||(a.registrationIndex??legs.indexOf(a))-(b.registrationIndex??legs.indexOf(b)));
      positions.forEach((index,i)=>{ordered[index]=group[i];});
    }
    return annotate(ordered,'部分段序与时间登记',[...issues(ordered),...extra]);
  }
  if(isChain(registered,aliases)&&!issues(registered).length)return annotate(registered,'登记顺序',[]);
  const byDate=[...legs].sort((a,b)=>routeTime(a).startDate.localeCompare(routeTime(b).startDate)||
    (Number.isFinite(a.scheduledStart)&&Number.isFinite(b.scheduledStart)?a.scheduledStart-b.scheduledStart:0)||
    (a.registrationIndex??legs.indexOf(a))-(b.registrationIndex??legs.indexOf(b)));
  const out=[];
  let previous=null;
  for(let i=0;i<byDate.length;){
    const time=routeTime(byDate[i]),window=time.startDate+'|'+time.endDate;
    let j=i;while(j<byDate.length){const t=routeTime(byDate[j]);if(t.startDate+'|'+t.endDate!==window)break;j++;}
    let group=byDate.slice(i,j);
    const startCandidates=previous?group.filter(l=>legsOrderJoin(previous,l,aliases)):[];
    let start;
    if(startCandidates.length){
      const rank=l=>{
        const end=l.points.at(-1),endName=l.names.at(-1);
        const rest=group.filter(o=>o!==l);
        const nextGap=rest.length?Math.min(...rest.map(next=>{
          const from=next.points[0],fromName=next.names[0];
          return joinsChain({lat:end[0],lon:end[1],name:endName},{point:from,name:fromName},{aliases}).joined?0:greatCircleKm(end,from);
        })):0;
        return [nextGap,isLoopRoute(l,aliases)?0:1,l.sequence??l.registrationIndex??Infinity,String(l.id)];
      };
      startCandidates.sort((a,b)=>{const sa=rank(a),sb=rank(b);for(let k=0;k<sa.length;k++)if(sa[k]!==sb[k])return sa[k]<sb[k]?-1:1;return 0;});
      start=group.indexOf(startCandidates[0]);
    }else{
      start=group.findIndex(l=>!group.some(o=>o!==l&&!isLoopRoute(o,aliases)&&legsOrderJoin(o,l,aliases)));
    }
    let firstInGroup=true;
    while(group.length){
      const entry=firstInGroup?(start<0?0:start):Math.max(0,group.findIndex(l=>!group.some(o=>o!==l&&!isLoopRoute(o,aliases)&&legsOrderJoin(o,l,aliases))));
      let cur=group.splice(entry,1)[0];
      firstInGroup=false;
      out.push(cur);
      for(;;){
        const candidates=group.map((route,k)=>({route,k})).filter(({route})=>legsOrderJoin(cur,route,aliases));
        if(!candidates.length)break;
        const score=({route,k})=>{
          const end=route.points.at(-1),endName=route.names.at(-1);
          const rest=group.filter((_,i)=>i!==k);
          const nextGap=rest.length?Math.min(...rest.map(next=>{
            const from=next.points[0],fromName=next.names[0];
            return joinsChain({lat:end[0],lon:end[1],name:endName},{point:from,name:fromName},{aliases}).joined?0:greatCircleKm(end,from);
          })):0;
          const loop=isLoopRoute(route,aliases)?0:1;
          return [nextGap,loop,route.sequence??route.registrationIndex??Infinity,String(route.id),k];
        };
        candidates.sort((a,b)=>{
          const sa=score(a),sb=score(b);
          for(let i=0;i<sa.length-1;i++){if(sa[i]!==sb[i])return sa[i]<sb[i]?-1:1;}
          return sa.at(-1)-sb.at(-1);
        });
        cur=group.splice(candidates[0].k,1)[0];out.push(cur);
      }
      previous=out.at(-1);
    }
    i=j;
  }
  return annotate(out,'时间与端点推定',issues(out).filter(s=>s.startsWith('日期')));
}

// Degree balance is necessary but insufficient. Disconnected day loops and
// temporally reversed edges cannot prove a single continuous round trip.
export function journeyClosure(journeys,aliases){
  const degree=new Map(),adjacency=new Map(),nodes=[];
  const at=(r,i)=>{
    const point=r.points[i],id=r.nodeIds?.[i];
    let node=nodes.find(n=>joinsChain({lat:n.point[0],lon:n.point[1],nodeId:n.id},{point,nodeId:id}).joined);
    if(!node){node={key:nodes.length,name:r.names[i],point,id};nodes.push(node);degree.set(node.key,{name:node.name,in:0,out:0});adjacency.set(node.key,new Set());}
    return node.key;
  };
  let realSegments=0;
  for(const j of journeys)for(const r of j.transport.filter(x=>x.include&&!isUnrestored(x))){
    for(let i=1;i<r.points.length;i++){
      const from=at(r,i-1),to=at(r,i);
      if(from===to)continue;
      realSegments++;degree.get(from).out++;degree.get(to).in++;
      adjacency.get(from).add(to);adjacency.get(to).add(from);
    }
  }
  const imbalanced=[...degree.values()].filter(v=>v.in!==v.out);
  const active=[...degree.keys()].filter(k=>degree.get(k).in||degree.get(k).out),visited=new Set(),components=[];
  for(const start of active){
    if(visited.has(start))continue;
    const stack=[start],component=[];visited.add(start);
    while(stack.length){const k=stack.pop();component.push(degree.get(k).name);for(const next of adjacency.get(k))if(!visited.has(next)){visited.add(next);stack.push(next);}}
    components.push(component);
  }
  const included=journeys.flatMap(j=>j.transport.filter(r=>r.include));
  const routes=included.filter(r=>!isGapControl(r));
  const unresolved=included.filter(isUnrestored);
  const trajectory=routes.length?trajectoryRows(routes,journeys,{aliases,scope:'journey'}):[];
  const orderIssues=[...new Set(trajectory.map(r=>r['排序问题']).filter(Boolean))];
  const breaks=trajectory.filter(r=>['断点','待还原','待核','待接续'].includes(r['接续状态']));
  const balanced=imbalanced.length===0&&realSegments>0,connected=components.length===1&&realSegments>0;
  const temporal=!orderIssues.some(s=>/日期|时间|段序重复/.test(s));
  const continuous=!breaks.length&&!unresolved.length;
  return {closed:balanced&&connected&&temporal&&continuous,balanced,connected,temporal,continuous,imbalanced,components,
    unrestored:unresolved.length,
    issues:[...(!connected?['移动图存在不连通分量']:[]),...unresolved.map(r=>`结构连接 ${r.id} 尚未还原`),...breaks.map(r=>r['接续说明']),...orderIssues]};
}

export function dateBounds(value){
  const {start,end}=sourceDateKeys(value);if(!start)return null;
  const lower=date=>date.length===4?date+'-01-01':date.length===7?date+'-01':date;
  const upper=date=>{if(date.length===4)return date+'-12-31';if(date.length===7){const [y,m]=date.split('-').map(Number);return date+'-'+new Date(Date.UTC(y,m,0)).getUTCDate();}return date;};
  return {start:lower(start),end:upper(end)};
}

export function routeDateBounds(row){
  const time=routeTime(row),start=dateBounds(time.startDate),end=dateBounds(time.endDate);
  return start&&end?{start:start.start,end:end.end}:null;
}

export function journeyDateViolations(journeys){
  const out=[];
  for(const j of journeys){
    const bounds=dateBounds(j.date);if(!bounds)continue;
    for(const r of j.transport.filter(x=>x.include!==false&&!isGapControl(x))){
      const time=routeTime(r),interval=routeDateBounds(r);
      // 粗月份/年份与行程范围有交集即不能断言越界；精确的错月/错日不能漏掉。
      const preciseOutside=time.startDate.length===10&&time.startDate<bounds.start||time.endDate.length===10&&time.endDate>bounds.end;
      if(interval&&(preciseOutside||interval.end<bounds.start||interval.start>bounds.end))out.push({journey:j.id,transport:r.id,
        date:time.startDate===time.endDate?time.startDate:`${time.startDate} — ${time.endDate}`,scope:j.date});
    }
  }
  return out;
}

// 在同一条实际轨迹上复核行程前后承接。闭环组只组织记录，不能仅凭
// “有一个接驳”或“首尾同名”掩盖组内断点；入出度和链路连续分别报告。
export function journeyContinuityRows(atlas){
  const aliases=atlas.journeyLayer.aliases,groups=new Map();
  for(const j of atlas.journeyLayer.journeys.filter(j=>j.include)){
    const id=j.closureGroup||j.id;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(j);
  }
  return [...groups].map(([id,js])=>{
    const ids=new Set(js.map(j=>j.id));
    const positions=atlas.trajectory.flatMap((r,i)=>ids.has(r['所属行程编号'])?[i]:[]);
    const first=positions[0],last=positions.at(-1);
    const rows=positions.map(i=>atlas.trajectory[i]);
    const gaps=rows.filter(r=>['断点','待还原','待核','待接续'].includes(r['接续状态']));
    const next=last===undefined?null:atlas.trajectory[last+1];
    const previous=first===undefined?null:atlas.trajectory[first-1];
    const graph=journeyClosure(js,aliases);
    const linked=rows.length>0&&!gaps.length&&!graph.unrestored&&graph.temporal&&(!next||!['断点','待还原','待核','待接续'].includes(next['接续状态']));
    const declaredOpen=js.every(j=>j.shape==='开放接续'&&j.closureBasis);
    const state=!linked?'待接续':graph.closed?'行程内闭环':declaredOpen?'开放接续（有依据）':'跨行程接续';
    return {'闭环组编号':id,'行程编号':js.map(j=>j.id).join('；'),'行程名称':js.map(j=>j.name).join('；'),
      '闭环状态':state,'节点入出度平衡':graph.balanced?'是':'否','链路连续':linked?'是':'否',
      '移动图连通':graph.connected?'是':'否','时间顺序有效':graph.temporal?'是':'否',
      '起点':rows[0]?.['出发地']||'','终点':rows.at(-1)?.['到达地']||'',
      '前序交通编号':previous?.['交通编号']||'资料起点','后序交通编号':next?.['交通编号']||'资料终点',
      '首尾承接':`${previous?.['到达地']||'资料起点'} → ${rows[0]?.['出发地']||''}；${rows.at(-1)?.['到达地']||''} → ${next?.['出发地']||'资料终点'}`,
      '待补接续':[...new Set([...gaps.map(r=>r['接续说明']),...graph.issues.filter(s=>/日期|时间|段序重复/.test(s))])].join('；'),
      '闭环依据':js.map(j=>j.closureBasis).filter(Boolean).join('；'),
      '关联正文':js.map(j=>j.source).join('；')};
  });
}

export function journeySummaryRows(layer){
  return layer.journeys.map(j=>{
    const included=j.transport.filter(r=>r.include),controls=included.filter(isUnrestored);
    const rs=orderLegs(included.filter(r=>!isUnrestored(r)),layer.aliases);
    const known=rs.filter(r=>r.km!=null&&r.countDistance!==false&&!isUnrestored(r));
    const trajectory=trajectoryRows(rs,[{...j,transport:rs}],{aliases:layer.aliases,scope:'journey'}),gaps=[];
    trajectory.forEach((row,i)=>{if(['断点','待还原','待核','待接续'].includes(row['接续状态']))gaps.push(`${trajectory[i-1]?.['交通编号']||''} → ${row['交通编号']}（${trajectory[i-1]?.['到达地']||''} → ${row['出发地']}）：${row['接续说明']}`);});
    gaps.push(...controls.map(r=>`${isGapControl(r)?'资料间隔':'结构连接'} ${r.id}：由前后记录限定必要接续，路径尚未还原`));
    const orderIssues=[...new Set(trajectory.map(r=>r['排序问题']).filter(Boolean))];
    return {'行程编号':j.id,'行程名称':j.name,'出发基地':j.base,'出发基地地点编号':j.baseId,'日期或区间':j.date,'重构状态':j.status,
      '路线片段':rs.map(r=>r.date+'：'+routeNames(r).join(' → ')).join('；'),'交通编号':j.transportIds.join('；'),'闭环组编号':j.closureGroup||'',
      '已计里程公里':!j.include?0:known.length?known.reduce((s,r)=>s+r.km,0):'','缺里程路线数':rs.filter(r=>r.km===null&&r.countDistance!==false&&!isUnrestored(r)).length,
      '分享纳入':j.include?'纳入':'排除','接续待核':gaps.join('；'),
      '接续已覆盖':'','排序问题':orderIssues.join('；'),
      '行程依据':j.evidence,'关联正文':j.source};
  });
}

export function improvementRows(atlas){
  const rows=[],parent=new Map(atlas.journeyLayer.journeys.flatMap(j=>j.transportIds.map(id=>[id,j.id])));
  const add=(type,id,issue,source='',journey='')=>rows.push({'类型':type,'对象编号':id,'关联行程编号':journey,'待完善内容':issue,'关联正文':source});
  for(const p of atlas.locationLayer.places){
    if(p.status==='待核'&&p.include)add('地点核定',p.id,p.country+' / '+p.name+'：候选线索尚未核定到访',p.source);
    if(p.status==='已到访'&&(p.lat===null||p.lon===null))add('地点坐标',p.id,p.country+' / '+p.name+'：核定地点缺代表坐标',p.source);
    if(p.access?.pending)add('地点接入',p.id,p.country+' / '+p.name+'：'+p.access.reason,p.source);
  }
  for(const j of atlas.journeyLayer.journeys)for(const r of j.transport.filter(r=>r.include&&j.include)){
    if(r.km===null&&r.countDistance!==false&&!isUnrestored(r))add('交通里程',r.id,r.names.join(' → ')+'：公里留空',r.source,j.id);
  }
  for(const id of atlas.journeyLayer.unassigned)add('行程归组',id,'交通尚未分配行程；继续保留在总体分享范围内','',parent.get(id)||'');
  for(const j of atlas.journeySummaries.filter(j=>j['接续待核']))add('行程接续',j['行程编号'],j['接续待核'],j['关联正文'],j['行程编号']);
  return rows;
}
