import test from 'node:test';
import assert from 'node:assert/strict';
import {buildManagedLinkRows} from '../scripts/managed-links.mjs';

const place=(id,name,point)=>({id,name,lat:point[0],lon:point[1],country:'日本',status:'已到访',include:true,first:'2001-01-01',last:'2013-01-01',source:'旅程.md'});
const route=(id,names,points,nodeIds,date,extra={})=>({id,names,points,nodeIds,nodePlaceIds:nodeIds,recordType:'旅行航段',
  nodeRefs:nodeIds.map((node,i)=>({id:node,placeId:node,point:points[i]})),mode:'铁路',date,countries:['日本'],source:'旅程.md',
  status:'合理推定',km:100,include:true,...extra});
const a=[35,139],b=[36,140],c=[37,141],d=[38,142];
const base=()=>({routes:[route('R1',['甲','乙'],[a,b],['A','B'],'2001-01-01'),route('R2',['丙','丁'],[c,d],['C','D'],'2001-01-03')],
  locationLayer:{places:[place('A','甲',a),place('B','乙',b),place('C','丙',c),place('D','丁',d)]},journeyLayer:{journeys:[]}});

test('原始相邻交通缺口生成精确绑定且不计量的维护提案',()=>{
  const {rows,issues}=buildManagedLinkRows(base());assert.deepEqual(issues,[]);assert.equal(rows.length,1);
  const r=rows[0];assert.match(r['交通编号'],/^LINK-[a-f0-9]{16}$/);
  assert.deepEqual([r['前序交通编号'],r['后序交通编号'],r['前序路线段'],r['后序路线段']],['R1','R2',1,1]);
  assert.equal(r['节点编号序列'],'B；C');assert.deepEqual(JSON.parse(r['坐标序列纬经']),[b,c]);
  assert.equal(r['开始日期'],'2001-01-01');assert.equal(r['结束日期'],'2001-01-03');
  assert.equal(r['交通方式'],'交通方式待定');assert.equal(r['发生状态'],'待还原');
  for(const key of ['里程公里','交通时长分钟','飞行时长分钟','距离模型'])assert.equal(r[key],'');
  assert.equal(r['计程纳入'],'否');assert.equal(r['核定结论'],'待核');assert.match(r['核定记录'],/不新增交通方式、公里或时长/);
});

test('候选、计划、展示城市聚合不改变真实端点和相邻次序',()=>{
  const atlas=base();atlas.routes[0].displayPoints=[c,d];atlas.routes[0].displayNames=['显示甲','显示乙'];
  atlas.routes.push(route('PLAN',['甲','丙'],[a,c],['A','C'],'2001-01-02',{status:'计划'}));
  atlas.routes.push(route('HUB',['乙','丙'],[b,c],['B','C'],'2001-01-02',{candidate:true,recordType:'接驳段'}));
  const [r]=buildManagedLinkRows(atlas).rows;assert.equal(r['途经节点'],'乙；丙');assert.equal(r['前序交通编号'],'R1');assert.equal(r['后序交通编号'],'R2');
});

test('稳定编号不会因其它早期交通或输入排列变化而改变',()=>{
  const atlas=base(),id=buildManagedLinkRows(atlas).rows[0]['交通编号'];
  atlas.routes.unshift(route('EARLY',['甲','甲'],[a,a],['A','A'],'1999-01-01'));atlas.routes.reverse();
  assert.equal(buildManagedLinkRows(atlas).rows.find(r=>r['前序交通编号']==='R1')['交通编号'],id);
});

test('每一段按真实前后段号绑定，不消费另一段或另一次旅行的连接',()=>{
  const atlas=base();atlas.routes[0]=route('R1',['甲','乙','丙'],[a,b,c],['A','B','C'],'2001-01-01');
  atlas.routes[1]=route('R2',['丁','甲'],[d,a],['D','A'],'2001-01-03');
  const [r]=buildManagedLinkRows(atlas).rows;assert.equal(r['前序路线段'],2);assert.equal(r['后序路线段'],1);
  atlas.managedConnections=[route('M1',['丙','丁'],[c,d],['C','D'],'2001-01-01—2001-01-03',{
    recordType:'接驳段',previousTransport:'R1',nextTransport:'R2',previousSegment:1,nextSegment:1,include:false})];
  assert.equal(buildManagedLinkRows(atlas).rows.length,1);
  atlas.managedConnections[0].previousSegment=2;assert.equal(buildManagedLinkRows(atlas).rows.length,0);
});

test('同一已登记多节点区间路线沿段序接续，不把整条结束日误作每段到达日',()=>{
  const atlas=base();atlas.routes=[route('R1',['甲','乙','丙'],[a,b,c],['A','B','C'],'2001-01-01—2001-01-10')];
  const out=buildManagedLinkRows(atlas);assert.deepEqual(out.rows,[]);assert.deepEqual(out.issues,[]);
});

test('人工纳入或排除的精确连接均阻止再生，端点矛盾进入问题而非重复补边',()=>{
  for(const include of [true,false]){
    const atlas=base();atlas.managedConnections=[route('M',['乙','丙'],[b,c],['B','C'],'2001-01-01—2001-01-03',{
      recordType:'接驳段',previousTransport:'R1',nextTransport:'R2',previousSegment:1,nextSegment:1,include})];
    assert.equal(buildManagedLinkRows(atlas).rows.length,0);
    atlas.managedConnections[0].points=[a,c];
    assert.equal(buildManagedLinkRows(atlas).issues[0].type,'managed-endpoint-conflict');
  }
});

test('既有连接缺段号时进入绑定完善问题，不生成重复连接',()=>{
  const atlas=base();atlas.managedConnections=[route('M',['乙','丙'],[b,c],['B','C'],'2001-01-01—2001-01-03',{
    recordType:'接驳段',previousTransport:'R1',nextTransport:'R2',include:false})];
  const out=buildManagedLinkRows(atlas);assert.equal(out.rows.length,0);assert.equal(out.issues[0].type,'managed-binding-incomplete');
});

test('同一正式原点多年后缺侧实例生成资料间隔，不伪造零公里驻留移动',()=>{
  const atlas=base();atlas.routes[1]=route('R2',['乙','丁'],[b,d],['B','D'],'2013-01-01');
  const {rows,issues}=buildManagedLinkRows(atlas);assert.deepEqual(issues,[]);assert.equal(rows.length,1);
  const r=rows[0];assert.equal(r['记录类型'],'资料间隔');assert.equal(r['节点编号序列'],'B；B');
  assert.equal(r['里程公里'],'');assert.equal(r['线形类型'],'unknown');assert.match(r['发生依据'],/不证明原地驻留/);
  const occurrences=[{id:'V1',placeId:'B',startDate:'2001-01-01',endDate:'2001-01-01',incoming:['R1'],outgoing:['OTHER']},
    {id:'V2',placeId:'B',startDate:'2013-01-01',endDate:'2013-01-01',incoming:[],outgoing:['R2']}];
  atlas.visitInstances=occurrences;assert.equal(buildManagedLinkRows(atlas).rows.length,0);
});

test('同点短停与粗年月相交窗口不被推成资料间隔',()=>{
  const atlas=base();atlas.routes[1]=route('R2',['乙','丁'],[b,d],['B','D'],'2001-01-02');
  assert.equal(buildManagedLinkRows(atlas).rows.length,0);
  atlas.routes[0].date='2001-01';atlas.routes[1].date='2001-01-15';assert.equal(buildManagedLinkRows(atlas).rows.length,0);
});

test('同正式地点编号不同原点记录实际端点的未知接驳，不生成零公里资料间隔',()=>{
  const atlas=base();atlas.routes[1]=route('R2',['乙','丁'],[[36.1,140],d],['B','D'],'2013-01-01');
  const out=buildManagedLinkRows(atlas);assert.deepEqual(out.issues,[]);assert.equal(out.rows.length,1);
  const r=out.rows[0];assert.equal(r['记录类型'],'接驳段');assert.equal(r['节点编号序列'],'B；B');
  assert.deepEqual(JSON.parse(r['坐标序列纬经']),[b,[36.1,140]]);assert.equal(r['里程公里'],'');
  assert.match(r['发生依据'],/端点间位移尚未恢复/);assert.equal(out.summary.sharedFormalEndpointLinks,1);
});

test('物理交通节点同编号不同原点仍报告身份冲突',()=>{
  const atlas=base();atlas.locationLayer.places=atlas.locationLayer.places.filter(p=>p.id!=='B');
  atlas.routes[1]=route('R2',['乙','丁'],[[36.1,140],d],['B','D'],'2013-01-01');
  const out=buildManagedLinkRows(atlas);assert.equal(out.rows.length,0);assert.equal(out.issues[0].type,'node-coordinate-conflict');
});

test('模型交通与正式地面地点同代表坐标但不同身份，按缺侧实例生成未知精确接续',()=>{
  const atlas=base();atlas.routes[0]=route('R1',['甲','乙'],[a,b],['A','TN-B'],'2001-01-01');
  atlas.routes[0].nodeRefs[1].placeId='';
  atlas.routes[1]=route('R2',['乙','丁'],[b,d],['B','D'],'2001-01-01');
  const out=buildManagedLinkRows(atlas);assert.deepEqual(out.issues,[]);const [r]=out.rows;
  assert.equal(r['记录类型'],'接驳段');assert.equal(r['节点编号序列'],'TN-B；B');
  assert.deepEqual(JSON.parse(r['坐标序列纬经']),[b,b]);assert.equal(r['里程公里'],'');
  assert.equal(r['计程纳入'],'否');assert.match(r['发生依据'],/不证明交通节点与地面地点物理等同/);
  assert.equal(out.summary.coLocatedIdentityLinks,1);
  // An unrelated existing entry must not be replaced or turned into a new
  // modeled airport transfer merely because the coordinates coincide.
  atlas.visitInstances=[{id:'V',placeId:'B',startDate:'2001-01-01',endDate:'2001-01-01',incoming:['OTHER'],outgoing:['R2']}];
  assert.equal(buildManagedLinkRows(atlas).rows.length,0);
});

test('正式地点离开后接同代表坐标的不同交通身份，同样补精确离开侧',()=>{
  const atlas=base();atlas.routes[1]=route('R2',['乙','丁'],[b,d],['TN-B','D'],'2001-01-02');
  atlas.routes[1].nodeRefs[0].placeId='';
  const out=buildManagedLinkRows(atlas);const [r]=out.rows;
  assert.equal(r['节点编号序列'],'B；TN-B');assert.equal(r['记录类型'],'接驳段');
  assert.equal(r['里程公里'],'');assert.equal(out.summary.coLocatedIdentityLinks,1);
});

test('前后交通区间重叠时保留可能时间范围，不能拿前段结束日制造逆序',()=>{
  const atlas=base();atlas.routes[0].date='2001-01-01—2001-01-10';atlas.routes[1].date='2001-01-05—2001-01-15';
  const out=buildManagedLinkRows(atlas);assert.deepEqual(out.issues,[]);const [r]=out.rows;
  assert.equal(r['开始日期'],'2001-01-01');assert.equal(r['结束日期'],'2001-01-15');
  assert.match(r['发生依据'],/原始时间窗口重叠/);
  atlas.routes[1].date='2001-01-05';const inner=buildManagedLinkRows(atlas).rows[0];
  assert.equal(inner['开始日期'],'2001-01-01');assert.equal(inner['结束日期'],'2001-01-05');
});

test('显式已登记顺序导致真实日期逆序时报告，不补造时间线',()=>{
  const atlas=base();atlas.journeyLayer.journeys=[{id:'J1',transport:[atlas.routes[1],atlas.routes[0]]}];
  atlas.routes[0].sequence=2;atlas.routes[1].sequence=1;
  const out=buildManagedLinkRows(atlas);assert.equal(out.rows.length,0);assert.equal(out.issues[0].type,'reverse-time');
});
