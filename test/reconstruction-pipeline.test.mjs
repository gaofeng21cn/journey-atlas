import test from 'node:test';
import assert from 'node:assert/strict';
import {orderLegs,trajectoryRows} from '../scripts/travel-layers.mjs';
import {localEpoch} from '../scripts/flight-time.mjs';
import {archivalMovementCover,classifyObservationConflicts} from '../scripts/global-mobility.mjs';
import {mergeReviewedVisitRows} from '../scripts/visit-instances.mjs';
import {reconstructionProgress} from '../scripts/reconstruction-progress.mjs';
import {orderedDisplayRoutes,isRecordedMovement} from '../src/route-semantics.mjs';
import {reconstructConnection,retainReviewedConnection} from '../scripts/reconstruct-connections.mjs';

const route=(id,names,points,extra={})=>({id,names,points,mode:'公路',date:'2020-01-01',startDate:'2020-01-01',endDate:'2020-01-01',include:true,km:10,...extra});
test('已登记的往返即便几何闭环，也不能覆盖客票时刻的真实先后',()=>{
 const out=route('OUT',['Origin Airport','Transfer Airport'],[[10,10],[20,20]],{mode:'飞机',scheduledStart:1});
 const back=route('BACK',['Transfer Airport','Origin Airport'],[[20,20],[10,10]],{mode:'飞机',scheduledStart:3});
 assert.deepEqual(orderLegs([back,out]).map(r=>r.id),['OUT','BACK']);
 assert.equal(localEpoch('2020-01-01','08:45','Asia/Shanghai'),Date.UTC(2020,0,1,0,45)/1000);
 assert.equal(localEpoch('2020-07-01','08:00','America/New_York'),Date.UTC(2020,6,1,12)/1000);
});
test('主干内部的日游先完成再离开；精确段绑定不制造整条路线依赖环',()=>{
 const trunk=route('T',['基地','中站','基地'],[[0,0],[0,1],[0,0]],{nodeIds:['A','B','A']});
 const branch=route('B',['中站','景区','中站'],[[0,1],[1,1],[0,1]],{nodeIds:['B','C','B']});
 const rows=trajectoryRows([branch,trunk],[]);
 assert.deepEqual(rows.map(r=>r['交通编号']+':'+r['路线段']),['T:1/2','B:1/2','B:2/2','T:2/2']);
 const identity=route('I',['中站','中站'],[[0,1],[0,1]],{recordType:'节点对应',countDistance:false,km:null,
   previousTransport:'T',previousSegment:1,nextTransport:'B',nextSegment:1});
 const withLink=trajectoryRows([branch,trunk,identity],[]);
 assert.deepEqual(withLink.map(r=>r['交通编号']),['T','I','B','B','T']);
 assert.equal(isRecordedMovement(identity),false);assert.deepEqual(orderedDisplayRoutes([identity,trunk]),[trunk]);
});
test('跨日区及转机的观测先对账原航空链，不用地面速度阈值拒绝真实航班',()=>{
 const a=route('F1',['A','B'],[[0,0],[0,10]],{mode:'飞机',scheduledStart:1,scheduledEnd:2});
 const b=route('F2',['B','C'],[[0,10],[0,20]],{mode:'飞机',scheduledStart:3,scheduledEnd:4});
 assert.deepEqual(archivalMovementCover([a,b],{lat:0,lon:0},{lat:0,lon:20},{date:'2020-01-02'}),['F1','F2']);
 assert.deepEqual(archivalMovementCover([a,b],{lat:0,lon:20},{lat:0,lon:0},{date:'2020-01-02'}),[]);
});
test('已复核多日到访不被生成器拆回两个单日访问与假资料间隔',()=>{
 const row=(id,start,end)=>({'到访编号':id,'地点编号':'P','行程编号':'J','开始日期':start,'结束日期':end,'前序到访编号':'','后序到访编号':''});
 const manual={...row('V1','2020-01-01','2020-01-07'),'核定方式':'证据复核'};
 const inferred=[row('V1','2020-01-01','2020-01-01'),row('V2','2020-01-07','2020-01-07')];
 assert.deepEqual(mergeReviewedVisitRows(inferred,[manual]),[manual]);
});
test('资料覆盖间隔不等于移动未恢复；处置过的噪声不再挂成交通缺口',()=>{
 const g={id:'G',recordType:'接驳段',km:5,travelMinutes:10,include:true};
 const interval={id:'D',recordType:'资料间隔',include:true,structuralLink:true};
 const p=reconstructionProgress({managedConnections:[g,interval],visitInstances:[{include:true,incoming:['G'],outgoing:['D'],access:{complete:true}}]});
 assert.equal(p.connections.restored,1);assert.equal(p.connections.pending,0);assert.equal(p.visits.observationCoverageOnly,1);
 const r=classifyObservationConflicts({conflicts:[{kind:'impossible-speed',distanceKm:.2,windowMinutes:.01}],summary:{}},[]);
 assert.equal(r.conflicts.length,0);assert.equal(r.dispositions[0].resolution,'position-clock-noise');
});
test('接续重建分别保存计量模型与不确定范围，同实体对应绝不凑零公里',()=>{
 const row={'交通编号':'L','坐标序列纬经':'[[0,0],[0,0.1]]','途经节点':'市区；机场','开始日期':'2020-01-01','结束日期':'2020-01-01','记录类型':'接驳段'};
 const d=reconstructConnection(row,{before:{id:'A'},after:{id:'B'}});
 assert.ok(d.row['里程公里']>0);assert.ok(d.row['交通时长分钟']>0);assert.equal(d.row['里程类型'],'model');assert.match(d.uncertainty,/车辆/);
 const changedWindow=reconstructConnection({...row,'结束日期':'2020-01-02'},{before:{id:'A'},after:{id:'B'}});
 assert.notEqual(changedWindow.row['核定记录'],d.row['核定记录']);
 const identity=reconstructConnection(row,{curation:{L:{identity:true,basis:'同一机场不同来源名称'}}});
 assert.equal(identity.row['计程纳入'],'否');assert.equal(identity.row['里程公里'],undefined);
});

test('重跑重建保留已核定接驳及身份对应，不用默认模型反向覆盖人工结果',()=>{
 const candidate={'交通编号':'L','开始日期':'2020-01-01','结束日期':'2020-01-01'};
 const reviewed={...candidate,'分享纳入':'纳入','核定结论':'合理重构','记录类型':'节点对应','核定记录':'本轮身份复核'};
 assert.equal(retainReviewedConnection(candidate,reviewed).row,reviewed);
 assert.equal(retainReviewedConnection({...candidate,'开始日期':'2020-01-02'},reviewed),null);
 assert.equal(retainReviewedConnection(candidate,reviewed,{L:{mode:'铁路'}}),null);
});

test('机场与服务城市的逻辑顺序跨越真实接驳距离，但不能被排成额外往返航班',()=>{
 const aliases=new Map([['East Airport','Metro Alpha'],['West Airport','Metro Alpha'],['North Airport','Metro Beta']]);
 const inbound=route('ARR',['Origin Airport','East Airport'],[[5,5],[10,20]],{mode:'飞机'});
 const flight=route('OUT',['West Airport','North Airport'],[[10.1,19.9],[30,40]],{mode:'飞机'});
 const loop=route('TOUR',['Metro Beta','Resort Point','Metro Beta'],[[30.1,40.1],[31,41],[30.1,40.1]]);
 const back=route('BACK',['North Airport','West Airport'],[[30,40],[10.1,19.9]],{mode:'飞机'});
 const rows=trajectoryRows([inbound,flight,loop,back],[{id:'J',transport:[inbound,flight,loop,back]}],{aliases});
 assert.deepEqual(rows.map(r=>r['交通编号']),['ARR','OUT','TOUR','TOUR','BACK']);
 assert.equal(rows.filter(r=>r['接续状态']==='断点').length,3);
});

test('只有修复前读取可容忍旧绑定顺序，正常加载仍拒绝反序连接',()=>{
 const a=route('A',['起点','中站'],[[0,0],[0,1]]),b=route('B',['中站','终点'],[[0,1],[0,2]]);
 const stale=route('OLD',['终点','起点'],[[0,2],[0,0]],{recordType:'接驳段',previousTransport:'B',previousSegment:1,nextTransport:'A',nextSegment:1});
 assert.throws(()=>trajectoryRows([a,b,stale],[]),/次序冲突/);
 assert.deepEqual(trajectoryRows([a,b,stale],[],{allowStaleBindings:true}).map(r=>r['交通编号']),['A','B']);
});
