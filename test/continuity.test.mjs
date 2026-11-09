import test from 'node:test';
import assert from 'node:assert/strict';
import {trajectoryRows,journeyDateViolations,journeyContinuityRows} from '../scripts/travel-layers.mjs';
import {attachAccess} from '../scripts/node-access.mjs';
import {validateContinuityDelta,createContinuityAudit} from '../scripts/continuity-audit.mjs';

const leg=(id,names,points)=>({id,names,points,include:true,date:'2020-01-01',mode:'公路',km:100,status:'合理占位'});

test('途经点的往返支线插入主线路段之间，随后从返回节点接续',()=>{
  const trunk=leg('main',['A','B','C'],[[0,0],[0,1],[0,2]]);
  const loop=leg('loop',['B','X','B'],[[0,1],[1,1],[0,1]]);
  const rows=trajectoryRows([trunk,loop],[]);
  assert.deepEqual(rows.map(r=>r['出发地']+'→'+r['到达地']),['A→B','B→X','X→B','B→C']);
  assert.equal(rows.filter(r=>r['接续状态']==='断点').length,0);
});

test('同日起点曾出现及200公里近邻都不能替代缺失移动',()=>{
  const rows=trajectoryRows([leg('one',['A','B'],[[0,0],[0,1]]),leg('two',['A','C'],[[0,0],[0,2]])],[]);
  assert.equal(rows[1]['接续状态'],'断点');
  assert.match(rows[1]['接续说明'],/中间移动未记录/);
});

test('自连接不能证明正式地点进入和离开，更新入口拒绝新增孤立点',()=>{
  const place={id:'P',name:'P',country:'测试',status:'已到访',include:true};
  const layer={places:[place],index:new Map([['P',place]]),summary:{}};
  attachAccess(layer,[{id:'self',nodeRefs:[{id:'P',placeId:'P'},{id:'P',placeId:'P'}]}]);
  assert.equal(layer.summary.pendingAccess,1);
  assert.deepEqual(layer.places[0].access.incoming,[]);
  assert.deepEqual(layer.places[0].access.outgoing,[]);
  assert.throws(()=>validateContinuityDelta({locationLayer:{places:[]},trajectory:[]},{locationLayer:layer,trajectory:[]}),/新增未接续/);
});

test('同年错月仍越界，年/月粗精度有交集时不补造精确日期',()=>{
  const journeys=[{id:'J',date:'2020-04-16',transport:[{id:'bad',include:true,date:'2020-04-30'},{id:'coarse',include:true,date:'2020-04'}]}];
  assert.deepEqual(journeyDateViolations(journeys).map(r=>r.transport),['bad']);
  assert.deepEqual(journeyDateViolations([{id:'span',date:'2020-10—11',transport:[{id:'nov',date:'2020-11-30',include:true}]}]),[]);
});

test('闭环组记录和首尾同名不能掩盖组内断点，开放接续必须由字段声明',()=>{
  const t=leg('one',['A','B','A'],[[0,0],[0,1],[0,0]]);
  const j={id:'J',include:true,name:'单向 返程缺失',source:'test.md',transport:[t],shape:'',closureBasis:''};
  const atlas={journeyLayer:{journeys:[j],aliases:new Map()},locationLayer:{places:[]},routes:[t],trajectory:[
    {'所属行程编号':'J','接续状态':'链条起点','出发地':'A','到达地':'B'},
    {'所属行程编号':'J','接续状态':'断点','出发地':'B','到达地':'A','接续说明':'缺移动'},
  ]};
  atlas.journeyContinuity=journeyContinuityRows(atlas);
  assert.equal(atlas.journeyContinuity[0]['闭环状态'],'待接续');
  assert.equal(createContinuityAudit(atlas).summary.openJourneys,1);
});

function managedAtlas(){
  const incoming={...leg('IN',['A','B'],[[0,0],[0,1]]),nodeIds:['A','B']};
  const outgoing={...leg('OUT',['C','A'],[[0,2],[0,0]]),nodeIds:['C','A']};
  const link={id:'LINK',include:true,recordType:'接驳段',status:'待还原',structuralLink:true,countDistance:false,
    names:['B','C'],points:[[0,1],[0,2]],nodeIds:['B','C'],previousTransport:'IN',previousSegment:1,nextTransport:'OUT',nextSegment:1,source:'test.md'};
  return {locationLayer:{places:[]},routes:[incoming,outgoing],managedConnections:[link],connectionIntervals:[],hubLinks:[],
    journeyLayer:{journeys:[{id:'J',date:'2020-01-01',include:true,transport:[incoming,outgoing],transportIds:['IN','OUT'],source:'test.md'}]},
    visitInstances:[{id:'V',placeId:'B',include:true,continuity:'待还原',incoming:['IN'],outgoing:['LINK'],access:{complete:true,pending:false}}],
    trajectory:[{'交通编号':'IN','路线段':'1/1','所属行程编号':'J','接续状态':'链条起点','出发地':'A','到达地':'B'},
      {'交通编号':'LINK','路线段':'1/1','接续状态':'待核','接续类型':'待还原接续','出发地':'B','到达地':'C'},
      {'交通编号':'OUT','路线段':'1/1','所属行程编号':'J','接续状态':'待还原','接续类型':'接续待还原','出发地':'C','到达地':'A'}],
    journeyContinuity:[{'闭环组编号':'J','行程编号':'J','闭环状态':'待接续','起点':'A','终点':'A','关联正文':'test.md'}]};
}

test('已维护必要连接与实例未知细节独立报告，不伪称闭环也不作为结构失败',()=>{
  const atlas=managedAtlas(),audit=createContinuityAudit(atlas);
  assert.equal(audit.summary.actionable,0);assert.equal(audit.summary.managedUnknownConnections,1);
  assert.equal(audit.summary.visitsAwaitingRestoration,1);assert.equal(audit.summary.managedJourneys,1);
  assert.equal(audit.summary.openJourneys,0);assert.equal(atlas.journeyContinuity[0]['闭环状态'],'待接续');
  assert.equal(audit.rows.find(r=>r['审计类型']==='已管理行程待还原')['当前状态'],'待还原，尚非真实闭环');
  assert.doesNotThrow(()=>validateContinuityDelta({locationLayer:{places:[]},trajectory:[]},atlas));
});

test('算法候选和无效连接不能替代正式管理，更新仍拒绝新未管理缺口',()=>{
  const atlas=managedAtlas();atlas.hubLinks=[{...atlas.managedConnections[0],candidate:true}];atlas.managedConnections=[];
  const candidate=createContinuityAudit(atlas);assert.ok(candidate.summary.actionable>0);
  assert.throws(()=>validateContinuityDelta({locationLayer:{places:[]},trajectory:[]},atlas),/新增未接续/);
  const invalid=managedAtlas();invalid.managedConnections[0].nodeIds[0]='WRONG';
  assert.equal(createContinuityAudit(invalid).summary.invalidConnections,1);
  assert.ok(createContinuityAudit(invalid).summary.actionable>0);
});

test('有管理的端点接续诊断保留待还原，真正时间或段序矛盾仍阻塞',()=>{
  const atlas=managedAtlas();atlas.trajectory[0]['排序问题']='登记端点未接续：IN → OUT';
  assert.equal(createContinuityAudit(atlas).summary.actionable,0);
  atlas.trajectory[0]['排序问题']='登记端点未接续：IN → OUT；显式段序重复';
  assert.equal(createContinuityAudit(atlas).summary.orderConflicts,1);
  assert.throws(()=>validateContinuityDelta(managedAtlas(),atlas),/结构矛盾/);
});

test('候选行政归属和未核GPS保留，不为让check归零自动晋级',()=>{
  const atlas={locationLayer:{places:[]},journeyLayer:{journeys:[]},routes:[],trajectory:[]};
  const candidates=[{'地点编号':'ADMIN','到访城市/地点':'龙岩','国家地区':'中国','核定状态':'行政归属'},
    {'地点编号':'GPS','到访城市/地点':'海边定位','国家地区':'中国','核定状态':'待核'}];
  const audit=createContinuityAudit(atlas,candidates);
  assert.equal(audit.summary.administrativeCandidates,1);assert.equal(audit.summary.candidatesNotFormal,1);assert.equal(audit.summary.actionable,0);
  candidates.push({'地点编号':'VISITED','到访城市/地点':'长汀','国家地区':'中国','核定状态':'地面到访'});
  assert.equal(createContinuityAudit(atlas,candidates).summary.confirmedCandidatesNotFormal,1);
  assert.equal(createContinuityAudit(atlas,candidates).summary.actionable,1);
});

test('资料间隔提供结构管理但不作已核移动或事实闭环',()=>{
  const atlas=managedAtlas(),gap=atlas.managedConnections[0];
  gap.recordType='资料间隔';gap.names=['B','B'];gap.points=[[0,1],[0,1]];gap.nodeIds=['B','B'];
  atlas.routes[1].nodeIds[0]='B';atlas.routes[1].points[0]=[0,1];
  atlas.connectionIntervals=[gap];atlas.managedConnections=[];
  const audit=createContinuityAudit(atlas);
  assert.equal(audit.summary.observationIntervals,1);assert.equal(audit.summary.actionable,0);
  assert.match(audit.rows.find(r=>r['审计类型']==='已管理资料间隔')['问题或结论'],/不证明原地驻留/);
});
