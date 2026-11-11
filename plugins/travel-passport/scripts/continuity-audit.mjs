import {journeyDateViolations,joinsChain} from './travel-layers.mjs';

export const AUDIT_HEADERS=['审计类型','对象编号','国家地区','地点名称','当前状态','入边数','出边数','移动边数','问题或结论','证据','关联正文','审计级别'];
const normalize=s=>String(s||'').trim().toLowerCase().replace(/[\s·•()（）]/g,'');
const segment=value=>Number(String(value??'').split('/')[0]);
const isManaged=r=>['接驳段','资料间隔','节点对应'].includes(r.recordType)&&r.include!==false&&r.candidate!==true;
const isUnrestored=r=>r.structuralLink===true||r.status==='待还原'||r.recordType==='资料间隔';
export function managedConnectionsFor(atlas){
  return [...new Map([...(atlas.managedConnections||[]),...(atlas.connectionIntervals||[]),...(atlas.routes||[]).filter(isManaged)].filter(isManaged).map(r=>[r.id,r])).values()];
}
function managementContext(atlas){
  const routes=new Map([...(atlas.routes||[]),...(atlas.journeyLayer?.journeys||[]).flatMap(j=>j.transport||[]),...managedConnectionsFor(atlas)].map(r=>[r.id,r]));
  const valid=[],invalid=[],length=r=>r?.nodeRefs?.length||r?.nodeIds?.length||r?.points?.length||0;
  const endpoint=(r,i)=>({id:r.nodeRefs?.[i]?.id||r.nodeIds?.[i]||'',point:r.nodeRefs?.[i]?.point||r.points?.[i]});
  const matches=(a,b)=>Array.isArray(a.point)&&Array.isArray(b.point)&&(!a.id||!b.id||a.id===b.id)&&
    joinsChain({lat:a.point[0],lon:a.point[1],nodeId:a.id},{point:b.point,nodeId:b.id}).joined;
  for(const r of managedConnectionsFor(atlas)){
    const before=routes.get(r.previousTransport),after=routes.get(r.nextTransport),p=segment(r.previousSegment),n=segment(r.nextSegment);
    if(!before||!after||!Number.isInteger(p)||!Number.isInteger(n)||p<1||n<1||p>=length(before)||n>=length(after)||length(r)!==2||
      !matches(endpoint(before,p),endpoint(r,0))||!matches(endpoint(after,n-1),endpoint(r,1))){invalid.push(r);continue;}
    valid.push(r);
  }
  const pair=(a,b)=>valid.filter(r=>r.previousTransport===a&&r.nextTransport===b),byId=new Map(valid.map(r=>[r.id,r]));
  const transition=(a,b)=>a&&b&&pair(a['交通编号'],b['交通编号']).some(r=>segment(r.previousSegment)===segment(a['路线段'])&&segment(r.nextSegment)===segment(b['路线段']));
  const diagnosticManaged=issue=>{
    const m=String(issue).match(/^登记端点未接续：(.+?) → (.+)$/);
    return m&&pair(m[1],m[2]).find(r=>segment(r.previousSegment)===length(routes.get(m[1]))-1&&segment(r.nextSegment)===1);
  };
  return {routes,valid,invalid,pair,byId,transition,diagnosticManaged};
}

// 审计和日常 check 使用同一份数据判定，不以关键词猜行程是否已闭环。
export function createContinuityAudit(atlas,candidates=[]){
  const rows=[],ctx=managementContext(atlas),orderSeen=new Set(),unmanaged=new Set(),managedTransitions=new Set(),
    places=atlas.locationLayer?.places||[],journeys=atlas.journeyLayer?.journeys||[];
  const add=(type,id,country,name,state,issue,evidence='',source='',access={},level='信息')=>rows.push({
    '审计类型':type,'对象编号':id,'国家地区':country,'地点名称':name,'当前状态':state,
    '入边数':access.incoming?.length??'','出边数':access.outgoing?.length??'','移动边数':access.routes?.length??'',
    '问题或结论':issue,'证据':evidence,'关联正文':source,'审计级别':level});
  const formal=new Map();
  for(const p of places)for(const name of [p.name,...(p.originalNames||[]),...(p.altNames||[]),...(p.groundNames||[])]){
    const k=p.country+'|'+normalize(name);if(name&&!formal.has(k))formal.set(k,p);
  }
  for(const c of candidates){
    const names=[c['到访城市/地点'],...String(c['原地名/机场']||'').split('；')];
    if(names.some(n=>formal.has(c['国家地区']+'|'+normalize(n))))continue;
    const decision=c['核定状态']||'';
    if(['飞越','定位沿用','排除'].includes(decision)){
      add('已排除定位线索',c['地点编号'],c['国家地区'],c['到访城市/地点'],decision,'保留证据，不作为到访或待晋级地点',c['核定依据']||c['证据'],c['关联正文']);continue;
    }
    if(decision==='行政归属'){
      add('行政归属线索',c['地点编号'],c['国家地区'],c['到访城市/地点'],decision,'保留行政归属，不建立额外到访或移动节点',c['核定依据']||c['证据'],c['关联正文']);continue;
    }
    const airport=decision==='机场/交通'||/转机|机场接触/.test(c['性质']||'');
    const confirmed=decision==='地面到访';
    add(airport?'机场/交通候选':confirmed?'已核到访未入正式地点':'候选未入正式地点层',c['地点编号'],c['国家地区'],c['到访城市/地点'],airport?'保留交通候选':confirmed?'已核地面到访':'待核定',
      airport?'保留交通身份，客票接触不等于城市到访':confirmed?'已核活动尚未对应正式节点，须连同进出移动维护':'候选尚未核定地面到访，保留证据，不自动晋级',c['证据'],c['关联正文'],{},confirmed?'结构错误':'候选保留');
  }
  for(const p of places)if(p.status==='已到访'&&p.include&&p.access?.pending){
    add('正式地点接续',p.id,p.country,p.name,p.access.state,p.access.reason,p.evidence,p.source,p.access,'结构错误');
  }
  for(const v of atlas.visitInstances||[]){
    if(!v.include)continue;const p=places.find(p=>p.id===v.placeId);
    if(v.access?.pending)add('到访实例缺接续',v.id,p?.country,p?.name,v.access.state,v.access.reason,v.evidence,v.source,v.access,'结构错误');
    else if(v.continuity==='待还原')add('到访实例待还原',v.id,p?.country,p?.name,'结构已接入、事实待还原','前后关系已登记；未知移动、方式和时间不代表已核路径',v.evidence,v.source,v.access,'待还原');
  }
  for(const r of atlas.routes||[])for(const n of r.nodeRefs||[]){
    if(!n.id)add('路线节点编号缺失',r.id,n.country,n.name,n.type,'路线节点缺少稳定编号',r.evidence,r.source,{},'结构错误');
  }
  for(const v of journeyDateViolations(journeys)){
      add('行程日期越界',v.transport,'',v.journey,'日期越界',`${v.date} 不在行程 ${v.scope} 内，须修正归属`, '',journeys.find(j=>j.id===v.journey)?.source,{},'结构错误');
  }
  for(const r of ctx.invalid)add('管理连接引用无效',r.id,'',(r.names||[]).join('→'),'引用矛盾','须精确绑定前后交通、路线段与原始端点',r.evidence,r.source,{},'结构错误');
  for(const r of ctx.valid)if(isUnrestored(r))add(r.recordType==='资料间隔'?'已管理资料间隔':'已管理移动待还原',r.id,'',(r.names||[]).join('→'),'待还原',
    r.recordType==='资料间隔'?'不同观测时点的间隔，不证明原地驻留、没有移动或真实闭环':'必要移动已有前后关系，方式与路径待还原；不计程，不升事实',r.evidence,r.source,{},'待还原');
  const trajectory=atlas.trajectory||[],candidateIds=new Set((atlas.hubLinks||[]).filter(c=>c.candidate===true&&!ctx.byId.has(c.id)).map(c=>c.id));
  let previousActual=null;
  trajectory.forEach((t,i)=>{
    const transport=t['交通编号'],ownManaged=ctx.byId.has(transport),candidate=candidateIds.has(transport);
    const controlled=ownManaged||ctx.transition(previousActual,t);
    for(const issue of String(t['排序问题']||'').split('；').filter(Boolean)){
      if(orderSeen.has(issue))continue;orderSeen.add(issue);const managed=ctx.diagnosticManaged(issue);
      const pending=managed&&isUnrestored(managed);
      add(managed?'已管理顺序接续':'轨迹排序矛盾',transport,'',`${t['出发地']}→${t['到达地']}`,managed?(pending?'待还原':'接续已核定'):'顺序矛盾',issue,t['发生状态'],t['关联正文'],{},managed?(pending?'待还原':'信息'):'结构错误');
    }
    if(['断点','待还原','待核','待接续'].includes(t['接续状态'])){
      if(controlled&&!candidate)managedTransitions.add(transport);
      else{const key=transport+'/'+(t['路线段']||'');unmanaged.add(key);add('轨迹断点',transport,'',`${t['出发地']}→${t['到达地']}`,'未管理接续',t['接续说明'],t['发生状态'],t['关联正文'],{},'结构错误');}
    }
    if(!ownManaged&&!candidate)previousActual=t;
  });
  for(const c of atlas.hubLinks||[])if(c.candidate===true&&!ctx.byId.has(c.id)&&!rows.some(r=>r['审计类型']==='轨迹断点'&&r['对象编号']===c.id))
    add('未管理接续候选',c.id,'',`${c.fromName}→${c.toName}`,'待登记','算法候选未进入维护源，不能充当已管理接续或真实移动',c.evidence,c.source,{},'结构错误');
  for(const row of atlas.journeyContinuity||[]){
    const state=row['闭环状态'];if(state==='行程内闭环')continue;
    const ids=new Set(String(row['行程编号']||'').split('；').filter(Boolean));
    const transportIds=new Set(journeys.filter(j=>ids.has(j.id)).flatMap(j=>j.transportIds||j.transport?.map(r=>r.id)||[]));
    const relevant=ctx.valid.filter(r=>transportIds.has(r.previousTransport)||transportIds.has(r.nextTransport));
    const groupUnmanaged=trajectory.some(t=>ids.has(t['所属行程编号'])&&unmanaged.has(t['交通编号']+'/'+(t['路线段']||'')));
    const groupOrder=rows.some(r=>r['审计类型']==='轨迹排序矛盾'&&transportIds.has(r['对象编号']));
    const managed=state==='待接续'&&relevant.some(isUnrestored)&&!groupUnmanaged&&!groupOrder;
    const type=state==='待接续'?(managed?'已管理行程待还原':'行程闭环'):state==='开放接续（有依据）'?'行程边界':'跨行程接续';
    add(type,row['闭环组编号'],'',row['起点']+'→'+row['终点'],managed?'待还原，尚非真实闭环':state,
      state==='待接续'?row['待补接续']||'移动链的前后端点尚未恢复为已核路径':
        `${row['首尾承接']}；前序 ${row['前序交通编号']}，后序 ${row['后序交通编号']}`,
      row['闭环依据']||'轨迹端点与前后交通编号可复核；未知连接独立保留',row['关联正文'],{},managed?'待还原':state==='待接续'?'结构错误':'信息');
  }
  const count=t=>rows.filter(r=>r['审计类型']===t).length;
  const summary={candidatesNotFormal:count('候选未入正式地点层'),confirmedCandidatesNotFormal:count('已核到访未入正式地点'),airportCandidates:count('机场/交通候选'),administrativeCandidates:count('行政归属线索'),
    formalDisconnected:count('正式地点接续'),visitDisconnected:count('到访实例缺接续'),visitsAwaitingRestoration:count('到访实例待还原'),dateScopeViolations:count('行程日期越界'),
    openJourneys:count('行程闭环'),managedJourneys:count('已管理行程待还原'),crossJourney:count('跨行程接续'),boundaryJourneys:count('行程边界'),
    trajectoryBreaks:count('轨迹断点'),unmanagedConnections:count('未管理接续候选'),managedConnections:ctx.valid.length,managedUnknownConnections:count('已管理移动待还原'),
    observationIntervals:count('已管理资料间隔'),managedTrajectoryTransitions:managedTransitions.size,invalidConnections:count('管理连接引用无效'),orderConflicts:count('轨迹排序矛盾'),managedOrderDiagnostics:count('已管理顺序接续'),
    nodeReferenceGaps:count('路线节点编号缺失'),rows:rows.length};
  summary.structuralErrors=rows.filter(r=>r['审计级别']==='结构错误').length;
  summary.awaitingRestoration=rows.filter(r=>r['审计级别']==='待还原').length;
  summary.actionable=summary.structuralErrors;
  return {summary,rows};
}

export function validateContinuityDelta(before,after,{withdrawnRoutes=[]}={}){
  const gaps=atlas=>new Set(createContinuityAudit(atlas).rows.filter(r=>r['审计级别']==='结构错误').map(r=>r['审计类型']+' '+r['对象编号']));
  const existing=gaps(before),withdrawn=new Set(withdrawnRoutes);
  for(const id of withdrawn)if(!(before.routes||[]).some(r=>r.id===id)||(after.routes||[]).some(r=>r.id===id))throw new Error('证据撤回必须对应原纳入、现排除的交通：'+id);
  const justified=new Set((before.locationLayer?.places||[]).filter(p=>p.access?.routes?.some(id=>withdrawn.has(id))).map(p=>'正式地点接续 '+p.id));
  for(const v of before.visitInstances||[])if([...(v.incoming||[]),...(v.outgoing||[])].some(id=>withdrawn.has(id)))justified.add('到访实例缺接续 '+v.id);
  for(let i=0;i<(before.trajectory||[]).length;i++){
    const t=before.trajectory[i];
    if(withdrawn.has(before.trajectory[i-1]?.['交通编号']))justified.add('轨迹断点 '+t['交通编号']);
  }
  const added=[...gaps(after)].filter(id=>!existing.has(id)&&!justified.has(id));
  if(added.length)throw new Error('更新新增未接续节点/移动或结构矛盾，请在同一补丁补齐前后关系：'+added.join('；'));
}
