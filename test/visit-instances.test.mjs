import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveVisitInstances,readVisitInstances,visitInstanceRows,visitInstanceSummary,VISIT_INSTANCE_HEADERS} from '../scripts/visit-instances.mjs';

const places=['A','B','C'].map(id=>({id,name:id,country:'中国',status:'已到访',include:true,first:'2024-01-01',source:'旅行.md'}));
const route=(id,nodes,date='2024-01-01',journeyId='J',extra={})=>({id,date,journeyId,include:true,evidence:'正文核定的移动',source:'旅行.md',
  nodeRefs:nodes.map(id=>({id,placeId:places.some(p=>p.id===id)?id:'',servicePlaceId:'',name:id,point:[30,110]})),...extra});
const journey=(id='J',date='2024-01-01',extra={})=>({id,date,include:true,source:'旅行.md',...extra});
const options=(routes,journeys=[journey()])=>({places,routes,journeys});
const reviewedRow=(id,placeId,incoming,outgoing,extra={})=>({
  '到访编号':id,'地点编号':placeId,'行程编号':'J','开始日期':'2024-01-01','结束日期':'2024-01-01','时间精度':'日',
  '活动性质':'地面到访','进入交通编号':incoming,'离开交通编号':outgoing,'前序到访编号':'','后序到访编号':'',
  '接续核定':'有据重构','核定方式':'正文核定','证据引用':'旅行.md','核定记录':'据明确往返记录核定此次接续',
  '关联正文':'旅行.md','分享纳入':'纳入','开放边界':'','边界依据':'',...extra,
});

test('每次到访独立，2001年入边不能与2031年出边合成完整实例',()=>{
  const ctx=options([route('OLD',['A','B'],'2001-01-01','OLDJ'),route('NEW',['B','C'],'2031-01-01','NEWJ')],
    [journey('OLDJ','2001'),journey('NEWJ','2031')]);
  const visits=deriveVisitInstances(ctx).filter(v=>v.placeId==='B');
  assert.equal(visits.length,2);
  assert.equal(visits[0].journeyId,'OLDJ');assert.equal(visits[1].journeyId,'NEWJ');
  assert.equal(visits[0].access.complete,false);assert.equal(visits[1].access.complete,false);
  assert.equal(visits[0].next,'');assert.equal(visits[1].previous,'');
});

test('同一行程的A→B→A重复地点拆开，B保留同一段的真实入出',()=>{
  const ctx=options([route('R',['A','B','A'])]);
  const visits=deriveVisitInstances(ctx);
  assert.equal(visits.filter(v=>v.placeId==='A').length,2);
  const b=visits.find(v=>v.placeId==='B');
  assert.deepEqual(b.incoming,['R']);assert.deepEqual(b.outgoing,['R']);
  assert.equal(b.access.complete,true);assert.equal(b.continuity,'有据重构');
  assert.equal(b.reviewMethod,'历史迁移');
  assert.equal(visitInstanceSummary(visits).missingIncoming,2);
});

test('两条实际路线相接形成驻留窗口，原始节点不同则不合并',()=>{
  const ctx=options([route('IN',['A','B'],'2024-01-01'),route('OUT',['B','C'],'2024-01-02')],[journey('J','2024-01')]);
  const visits=deriveVisitInstances(ctx).filter(v=>v.placeId==='B');
  assert.equal(visits.length,1);assert.equal(visits[0].startDate,'2024-01-01');assert.equal(visits[0].endDate,'2024-01-02');
  assert.deepEqual(visits[0].incoming,['IN']);assert.deepEqual(visits[0].outgoing,['OUT']);
  assert.equal(visits[0].timePrecision,'区间');
  const different=options([route('IN',['A','B']),route('OUT',['AIRPORT','C'])]);
  different.routes[1].nodeRefs[0].servicePlaceId='B';different.routes[1].displayNames=['B','C'];
  assert.equal(deriveVisitInstances(different).find(v=>v.placeId==='B').access.complete,false);
});

test('同一行程编号也不能掩盖跨年断档，长驻必须有明确阶段接续依据',()=>{
  const ctx=options([route('IN',['A','B'],'2001-01-01'),route('OUT',['B','C'],'2031-01-01')],[journey('J','2001—2031')]);
  const visits=deriveVisitInstances(ctx).filter(v=>v.placeId==='B');
  assert.equal(visits.length,2);assert.ok(visits.every(v=>v.access.pending));
  const stage=options([route('IN',['A','B'],'2024-01-01'),route('OUT',['B','C'],'2024-06-01')],
    [journey('J','2024',{closureGroup:'STAGE',closureBasis:'本人同期长期驻地正文确认该阶段在B居住'})]);
  const staying=deriveVisitInstances(stage).filter(v=>v.placeId==='B');
  assert.equal(staying.length,1);assert.equal(staying[0].access.complete,true);
});

test('机场服务城市和显示层不能证明地面到访，没有路线的已核地点保留待接入',()=>{
  const r=route('FLIGHT',['AIRPORT','OUTSIDE']);r.nodeRefs[0].servicePlaceId='A';r.displayNames=['A','C'];
  const visits=deriveVisitInstances(options([r]));
  const a=visits.find(v=>v.placeId==='A');assert.ok(a);
  assert.deepEqual(a.incoming,[]);assert.deepEqual(a.outgoing,[]);assert.equal(a.access.pending,true);
  assert.equal(a.continuity,'待还原');
});

test('粗日期路线不制造中间节点具体日，候选可回读且保持稳定编号',()=>{
  const ctx=options([route('R',['A','B','C'],'2024-01-01 — 2024-01-10')],[journey('J','2024-01')]);
  const visits=deriveVisitInstances(ctx),b=visits.find(v=>v.placeId==='B');
  assert.equal(b.startDate,'2024-01-01');assert.equal(b.endDate,'2024-01-10');
  const rows=visitInstanceRows(visits);
  assert.deepEqual(Object.keys(rows[0]),[...VISIT_INSTANCE_HEADERS]);
  assert.equal(readVisitInstances(rows,ctx).length,visits.length);
  assert.deepEqual(deriveVisitInstances(ctx).map(v=>v.id),visits.map(v=>v.id));
});

test('粗月到访与窄行程相交可回读，不制造具体日；精确越界仍拒绝',()=>{
  const ctx=options([route('R',['A','B','C'],'2024-01')],[journey('J','2024-01-14')]);
  const rows=visitInstanceRows(deriveVisitInstances(ctx));
  assert.equal(readVisitInstances(rows,ctx).length,rows.length);
  assert.ok(rows.every(r=>r['开始日期']==='2024-01'&&r['结束日期']==='2024-01'));
  const wrong=reviewedRow('V','B','R','R',{'开始日期':'2024-01-15','结束日期':'2024-01-15'});
  assert.throws(()=>readVisitInstances([wrong],ctx),/超出行程范围/);
});

test('维护表拒绝异期交通、错误方向与跨行程引用',()=>{
  const ctx=options([route('IN',['A','B']),route('OUT',['B','A']),route('OLD',['A','B'],'2001-01-01'),route('OTHER',['B','A'],'2024-01-01','OTHER')],
    [journey(),journey('OTHER')]);
  assert.throws(()=>readVisitInstances([reviewedRow('V','B','OLD','OUT')],ctx),/本次时间不相交/);
  assert.throws(()=>readVisitInstances([reviewedRow('V','B','OUT','IN')],ctx),/未实际进入\/离开/);
  assert.throws(()=>readVisitInstances([reviewedRow('V','B','IN','OTHER')],ctx),/另一行程/);
});

test('正规未知接续提供结构引用，但不会迁移成为有据重构',()=>{
  const ctx=options([route('IN',['A','B']),route('OUT',['C','A']),route('R',['B','C'],'2024-01-01','',{
    recordType:'接驳段',status:'待还原',structuralLink:true,previousTransport:'IN',previousSegment:1,nextTransport:'OUT',nextSegment:1,
  })]);
  const b=deriveVisitInstances(ctx).find(v=>v.placeId==='B');
  assert.equal(b.access.complete,true);assert.equal(b.access.pending,false);
  assert.equal(b.continuity,'待还原');assert.equal(b.access.state,'待还原');
});

test('仅原始节点和紧邻日期吻合的跨行程驻留可以承接，前后仍是独立实例',()=>{
  const ctx=options([route('IN',['A','B'],'2024-01-01','J1'),route('OUT',['B','C'],'2024-01-02','J2')],
    [journey('J1','2024-01-01'),journey('J2','2024-01-02')]);
  const visits=deriveVisitInstances(ctx),b=visits.filter(v=>v.placeId==='B');
  assert.equal(b.length,2);assert.equal(b[0].next,b[1].id);assert.equal(b[1].previous,b[0].id);
  assert.equal(b[0].access.complete,true);assert.equal(b[1].access.complete,true);
  assert.equal(readVisitInstances(visitInstanceRows(visits),ctx).length,visits.length);
});

test('前后实例不能靠同名节点伪造承接，也不能用自引用闭环',()=>{
  const ctx=options([route('IN',['A','B']),route('OUT',['C','A'])]);
  const one=reviewedRow('V1','B','IN','',{'接续核定':'待还原','后序到访编号':'V2'});
  const two=reviewedRow('V2','C','','OUT',{'接续核定':'待还原','前序到访编号':'V1'});
  assert.throws(()=>readVisitInstances([one,two],ctx),/缺原始节点与交通承接/);
  assert.throws(()=>readVisitInstances([reviewedRow('V','B','IN','',{'接续核定':'待还原','前序到访编号':'V'})],ctx),/自引用/);
});

test('往返不能把同一地点的一次实例接成前后引用环',()=>{
  const ctx=options([route('GO',['A','B']),route('BACK',['B','A'])]);
  const a=reviewedRow('VA','A','BACK','GO',{'前序到访编号':'VB','后序到访编号':'VB'});
  const b=reviewedRow('VB','B','GO','BACK',{'前序到访编号':'VA','后序到访编号':'VA'});
  assert.throws(()=>readVisitInstances([a,b],ctx),/引用成环/);
});

test('开放边界必须显式说明，缺边到访不能核为完整',()=>{
  const ctx=options([route('R',['A','B'])]);
  assert.throws(()=>readVisitInstances([reviewedRow('V','A','','R')],ctx),/尚缺进出边/);
  assert.throws(()=>readVisitInstances([reviewedRow('V','A','','R',{'开放边界':'开始'})],ctx),/缺边界依据/);
  const visits=readVisitInstances([reviewedRow('V','A','','R',{'开放边界':'开始','边界依据':'已登记轨迹的最早记录，以同期驻地正文作为开始边界'})],ctx);
  assert.equal(visits[0].access.complete,true);
  assert.equal(visitInstanceSummary(visits).openBoundaries,1);
});

test('正式必要LINK只补原始前后段对应到访，不另种一次旅行',()=>{
  const link=route('LINK',['B','C'],'2024-01-01 — 2024-01-02','',{
    recordType:'接驳段',status:'待还原',structuralLink:true,countDistance:false,
    previousTransport:'IN',previousSegment:1,nextTransport:'OUT',nextSegment:1,
  });
  const ctx=options([route('IN',['A','B'],'2024-01-01','J1'),route('OUT',['C','A'],'2024-01-02','J2'),link],
    [journey('J1','2024-01-01'),journey('J2','2024-01-02')]);
  const visits=deriveVisitInstances(ctx),b=visits.find(v=>v.placeId==='B'),c=visits.find(v=>v.placeId==='C');
  assert.equal(visits.filter(v=>!v.journeyId).length,0);
  assert.deepEqual(b.outgoing,['LINK']);assert.deepEqual(c.incoming,['LINK']);
  assert.equal(b.access.complete,true);assert.equal(c.access.complete,true);
  assert.equal(b.continuity,'待还原');assert.equal(c.continuity,'待还原');
  assert.equal(b.next,c.id);assert.equal(c.previous,b.id);
  assert.equal(readVisitInstances(visitInstanceRows(visits),ctx).length,visits.length);
});

test('跨年同点资料间隔保持两个到访，只证明结构关系而不证明驻留或移动',()=>{
  const interval=route('GAP',['B','B'],'2001-01-01 — 2031-01-01','',{
    recordType:'资料间隔',status:'待还原',structuralLink:true,countDistance:false,countDuration:false,
    previousTransport:'OLD',previousSegment:1,nextTransport:'NEW',nextSegment:1,
  });
  const ctx=options([route('OLD',['A','B'],'2001-01-01','OLDJ'),route('NEW',['B','C'],'2031-01-01','NEWJ'),interval],
    [journey('OLDJ','2001'),journey('NEWJ','2031')]);
  const visits=deriveVisitInstances(ctx),b=visits.filter(v=>v.placeId==='B');
  assert.equal(b.length,2);assert.equal(b[0].startDate,'2001-01-01');assert.equal(b[1].startDate,'2031-01-01');
  assert.deepEqual(b[0].outgoing,['GAP']);assert.deepEqual(b[1].incoming,['GAP']);
  assert.ok(b.every(v=>v.access.complete&&!v.access.pending&&v.continuity==='待还原'));
  assert.equal(interval.mode,undefined);assert.equal(interval.km,undefined);
  assert.equal(readVisitInstances(visitInstanceRows(visits),ctx).length,visits.length);
  const upgraded=visitInstanceRows(visits);upgraded.find(v=>v['到访编号']===b[0].id)['接续核定']='有据重构';
  assert.throws(()=>readVisitInstances(upgraded,ctx),/不能抬高接续核定/);
});

test('必要LINK按具体路线段区分同路线里重复的到访，不凭地点名补任何一趟',()=>{
  const link=route('LINK',['B','C'],'2024-01-01','',{
    recordType:'接驳段',status:'待还原',structuralLink:true,previousTransport:'LOOP',previousSegment:3,nextTransport:'OUT',nextSegment:1,
  });
  const ctx=options([route('LOOP',['A','B','A','B']),route('OUT',['C','A'],'2024-01-01','J2'),link],[journey(),journey('J2')]);
  const b=deriveVisitInstances(ctx).filter(v=>v.placeId==='B');
  assert.equal(b.length,2);assert.equal(b[0].outgoing.includes('LINK'),false);assert.equal(b[1].outgoing.includes('LINK'),true);
  assert.equal(b[0].continuity,'有据重构');assert.equal(b[1].continuity,'待还原');
});

test('资料间隔不能用同一次到访自补入出，也不能靠服务城市替换物理节点',()=>{
  const interval=route('GAP',['B','B'],'2024-01-01','',{
    recordType:'资料间隔',status:'待还原',structuralLink:true,previousTransport:'R',previousSegment:1,nextTransport:'R',nextSegment:2,
  });
  const ctx=options([route('R',['A','B','C']),interval]);
  const visits=deriveVisitInstances(ctx),b=visits.find(v=>v.placeId==='B');
  assert.equal(b.incoming.includes('GAP'),false);assert.equal(b.outgoing.includes('GAP'),false);
  assert.ok(visits.connectionIssues.some(v=>v.reason.includes('两个不同到访')));
  const mismatch=route('LINK',['B','C'],'2024-01-01','',{
    recordType:'接驳段',status:'待还原',structuralLink:true,previousTransport:'AIR',previousSegment:1,nextTransport:'OUT',nextSegment:1,
  });
  const air=route('AIR',['A','AIRPORT']);air.nodeRefs[1].servicePlaceId='B';
  const bad=deriveVisitInstances(options([air,route('OUT',['C','A']),mismatch]));
  assert.ok(bad.connectionIssues.some(v=>v.reason.includes('原始端点未精确绑定')));
  assert.equal(bad.some(v=>v.incoming.includes('LINK')||v.outgoing.includes('LINK')),false);
});

test('同地点编号的不同实地点不能合并驻留，显式未知接驳只补结构',()=>{
  const incoming=route('IN',['A','B']),outgoing=route('OUT',['B','C'],'2024-01-01','J2');
  incoming.nodeRefs[1].point=[30,110];outgoing.nodeRefs[0].point=[30.2,110];
  const link=route('LOCAL',['B','B'],'2024-01-01','',{
    recordType:'接驳段',status:'待还原',structuralLink:true,countDistance:false,
    previousTransport:'IN',previousSegment:1,nextTransport:'OUT',nextSegment:1,
  });
  link.nodeRefs[0].point=[30,110];link.nodeRefs[1].point=[30.2,110];
  const ctx=options([incoming,outgoing,link],[journey(),journey('J2')]);
  const visits=deriveVisitInstances(ctx),b=visits.filter(v=>v.placeId==='B');
  assert.equal(b.length,2);assert.ok(b.every(v=>v.access.complete&&v.continuity==='待还原'));
  assert.equal(readVisitInstances(visitInstanceRows(visits),ctx).length,visits.length);
  link.recordType='资料间隔';
  assert.ok(deriveVisitInstances(ctx).connectionIssues.length>0);
  outgoing.journeyId='J';link.recordType='接驳段';
  const sameJourney=deriveVisitInstances(options([incoming,outgoing,link]));
  assert.equal(sameJourney.filter(v=>v.placeId==='B').length,2);
});

test('到访实例沿用轨迹的主干与支线实际分段顺序，不从整条路线制造孤立访问',()=>{
  const trunk=route('MAIN',['A','B','C']),loop=route('LOOP',['B','X','B']);
  loop.nodeRefs[1].placeId='X';
  trunk.nodeRefs.forEach((n,i)=>{n.point=[[0,0],[0,1],[0,2]][i];});
  loop.nodeRefs.forEach((n,i)=>{n.point=[[0,1],[1,1],[0,1]][i];});
  const ctx={places:[...places,{id:'X',name:'X',status:'已到访',include:true,first:'2024-01-01',source:'旅行.md'}],
    routes:[trunk,loop],journeys:[journey()]};
  const visits=deriveVisitInstances(ctx),b=visits.filter(v=>v.placeId==='B');
  assert.equal(b.length,2);assert.ok(b.every(v=>v.access.complete));
  assert.deepEqual(b[0].incoming,['MAIN']);assert.deepEqual(b[0].outgoing,['LOOP']);
  assert.deepEqual(b[1].incoming,['LOOP']);assert.deepEqual(b[1].outgoing,['MAIN']);
  assert.equal(new Set(visits.map(v=>v.id)).size,visits.length);
  assert.equal(readVisitInstances(visitInstanceRows(visits),ctx).length,visits.length);
});

test('实例排序沿用行程登记依赖，不能用相同起日的局部registration重新排序',()=>{
  const incoming=route('IN',['A','B'],'2024-01-01 — 2024-01-02');
  const departure=route('OUT',['B','C'],'2024-01-02');
  const ctx=options([departure,incoming],[journey('J','2024-01',{transportIds:['IN','OUT']})]);
  const b=deriveVisitInstances(ctx).filter(v=>v.placeId==='B');
  assert.equal(b.length,1);assert.deepEqual(b[0].incoming,['IN']);assert.deepEqual(b[0].outgoing,['OUT']);
  assert.equal(b[0].access.complete,true);
});

test('合成城市内活动保留既有到达实例，不切断驻留也不把同点自环计作入出边',()=>{
  const arrived=route('ARRIVED',['A','B']),activity=route('ACTIVITY',['B','B'],'2024-01-02','J',{km:20}),departed=route('DEPARTED',['B','C'],'2024-01-03');
  const ctx=options([arrived,activity,departed],[journey('J','2024-01',{transportIds:['ARRIVED','ACTIVITY','DEPARTED']})]);
  const visits=deriveVisitInstances(ctx),b=visits.filter(v=>v.placeId==='B');
  assert.equal(b.length,1);assert.equal(b[0].access.complete,true);
  assert.deepEqual(b[0].incoming,['ARRIVED']);assert.deepEqual(b[0].outgoing,['DEPARTED']);
  assert.deepEqual(b[0].activityTransports,['ACTIVITY']);assert.equal(b[0].startDate,'2024-01-01');assert.equal(b[0].endDate,'2024-01-03');
  assert.equal(readVisitInstances(visitInstanceRows(visits),ctx).length,visits.length);
});

test('合成市内活动可作为未知出口LINK的精确锚点，却不能假充进入边',()=>{
  const arrived=route('ARRIVED',['A','B']),activity=route('ACTIVITY',['B','B'],'2024-01-02','J',{km:20}),departed=route('DEPARTED',['C','A'],'2024-01-03','J2');
  const link=route('LINK',['B','C'],'2024-01-02 — 2024-01-03','',{
    recordType:'接驳段',status:'待还原',structuralLink:true,previousTransport:'ACTIVITY',previousSegment:1,nextTransport:'DEPARTED',nextSegment:1,
  });
  const ctx=options([arrived,activity,departed,link],[journey('J','2024-01',{transportIds:['ARRIVED','ACTIVITY']}),journey('J2','2024-01-03')]);
  const visits=deriveVisitInstances(ctx),b=visits.filter(v=>v.placeId==='B');
  assert.equal(b.length,1);assert.deepEqual(b[0].incoming,['ARRIVED']);assert.deepEqual(b[0].outgoing,['LINK']);
  assert.equal(b[0].access.complete,true);assert.equal(b[0].continuity,'待还原');
  assert.deepEqual(visits.connectionIssues,[]);
  assert.equal(readVisitInstances(visitInstanceRows(visits),ctx).length,visits.length);
  const forged=visitInstanceRows(visits);forged.find(r=>r['地点编号']==='B')['进入交通编号']='ACTIVITY';
  assert.throws(()=>readVisitInstances(forged,ctx),/未实际进入\/离开/);
});

test('计划交通到已去过的城市仍是计划到访，不改变永久地点事实',()=>{
  const ctx=options([route('PLAN',['A','B','C'],'2024-01-01','J',{status:'计划'})]);
  const visits=deriveVisitInstances(ctx),b=visits.find(v=>v.placeId==='B');
  assert.equal(b.activity,'计划到访');assert.equal(ctx.places.find(p=>p.id==='B').status,'已到访');
  assert.equal(visitInstanceSummary(visits).byActivity['计划到访'],3);
  assert.equal(readVisitInstances(visitInstanceRows(visits),ctx).find(v=>v.id===b.id).activity,'计划到访');
  const forged=visitInstanceRows(visits);forged.find(r=>r['到访编号']===b.id)['活动性质']='地面到访';
  assert.throws(()=>readVisitInstances(forged,ctx),/仅计划交通不能核为/);
});

test('核定结论为计划同样保留计划，未知结构LINK不能使计划晋级',()=>{
  const plan=route('PLAN',['A','B'],'2024-01-01','J',{review:{conclusion:'计划'}}),next=route('NEXT',['C','A'],'2024-01-02','J2',{status:'计划'});
  const link=route('LINK',['B','C'],'2024-01-01 — 2024-01-02','',{
    recordType:'接驳段',status:'待还原',structuralLink:true,previousTransport:'PLAN',previousSegment:1,nextTransport:'NEXT',nextSegment:1,
  });
  const ctx=options([plan,next,link],[journey(),journey('J2','2024-01-02')]);
  const visits=deriveVisitInstances(ctx),b=visits.find(v=>v.placeId==='B');
  assert.equal(b.activity,'计划到访');assert.equal(b.access.complete,true);assert.equal(b.continuity,'待还原');
  const rows=visitInstanceRows(visits);rows.find(r=>r['到访编号']===b.id)['活动性质']='地面到访';
  assert.throws(()=>readVisitInstances(rows,ctx),/仅计划交通不能核为/);
});

test('实际与计划混合仅引用本次时间相交的原始交通，不能借异期实际边确认',()=>{
  const ctx=options([route('ACTUAL',['A','B']),route('PLAN',['B','C'],'2024-01-01','J',{status:'计划'}),route('OLD',['A','B'],'2001-01-01','OLDJ')],
    [journey(),journey('OLDJ','2001')]);
  const b=deriveVisitInstances(ctx).find(v=>v.placeId==='B');
  assert.equal(b.activity,'地面到访');
  assert.equal(readVisitInstances(visitInstanceRows(deriveVisitInstances(ctx)),ctx).find(v=>v.id===b.id).activity,'地面到访');
  const wrong=reviewedRow('V','B','OLD','PLAN');
  assert.throws(()=>readVisitInstances([wrong],ctx),/本次时间不相交/);
});
