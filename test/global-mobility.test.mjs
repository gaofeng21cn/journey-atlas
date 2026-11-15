import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileMobility,effectiveMobilityRoutes,projectMobility,trimFlightTrackFragments,unstableReconstructionDates} from '../scripts/global-mobility.mjs';

const node=(id,lat,lon)=>({id,name:id,lat,lon,country:'甲国'});
const a=node('A',35,139),b=node('B',35,140),c=node('C',35.02,139.01);
const movement=(id,from,to,extra={})=>({id,tripId:id,date:'2024-01-01',startDate:'2024-01-01',endDate:'2024-01-01',fromNodeId:from.id,toNodeId:to.id,fromVisitId:id+'a',toVisitId:id+'b',sourceKind:'gps',km:90,travelMinutes:60,distanceRange:[80,100],durationRange:[50,70],start:100,end:3700,evidenceReferences:['GPS'],measurementBasis:'定位窗口',mode:'市内交通',...extra});
const reference=extra=>({id:'R',mode:'公路',points:[[a.lat,a.lon],[b.lat,b.lon]],date:'2024-01-01',startDate:'2024-01-01',endDate:'2024-01-01',km:120,travelMinutes:120,distanceType:'model',countDistance:true,include:true,...extra});
const recon=moves=>({nodes:[a,b,c],moves,conflicts:[]});

test('较长的已识别步行仍保留方式，不能因30公里阈值改成车辆移动',()=>{
  const r=reconcileMobility([],recon([movement('WALK',a,b,{mode:'步行',km:35})]));
  assert.equal(effectiveMobilityRoutes(r)[0].mode,'步行');assert.equal(r.summary.totalKm,35);
});

test('同一完整定位链细化交通模型，只计一次；原始公里不改写',()=>{
  const original=reference(),r=reconcileMobility([original],recon([movement('M',a,b)])),effective=effectiveMobilityRoutes(r);
  assert.equal(r.summary.coveredMoves,1);assert.equal(r.summary.additionalMoves,0);assert.equal(r.summary.totalKm,90);
  assert.equal(original.km,120);assert.equal(effective[0].sourceKm,120);assert.equal(effective[0].km,90);assert.equal(effective[0].travelMinutes,60);
});

test('客票里程拥有计量；照片或定位关联不再重复加到飞行总量',()=>{
  const r=reconcileMobility([reference({mode:'飞机',distanceType:'archived'})],recon([movement('M',a,b,{sourceKind:'gap'})]));
  assert.equal(r.summary.totalKm,120);assert.equal(r.summary.coveredMoves,1);assert.equal(r.ownership[0].action,'reference-owns');
  assert.equal(effectiveMobilityRoutes(r)[0].mode,'飞机');
});

test('粗时间窗不能吞掉全部重复通勤，同城同日不能当重复依据，方向不同分别保留',()=>{
  const moves=[movement('M1',a,b),movement('M2',a,b,{date:'2024-01-02'}),movement('RETURN',b,a,{date:'2024-01-02'}),movement('LOCAL',a,c,{km:2})];
  const r=reconcileMobility([reference({endDate:'2024-01-31'})],recon(moves));
  assert.equal(r.summary.coveredMoves,1);assert.equal(r.summary.additionalMoves,3);assert.equal(r.summary.totalKm,272);
  assert.ok(r.additions.some(m=>m.names[0]==='B'&&m.names[1]==='A'));
});

test('城市投影复用同一物理移动编号和计量，不另造一份移动',()=>{
  const moves=[movement('M1',a,c,{km:2,travelMinutes:10,order:1,distanceRange:[1,3],durationRange:[8,12]})];
  const source={...recon(moves),version:1,visits:[{id:'M1a',nodeId:'A',incoming:[],outgoing:['M1'],boundary:'窗口起点'},{id:'M1b',nodeId:'C',incoming:['M1'],outgoing:[],boundary:'窗口终点'}],journeys:[],stationary:[]};
  const geo={features:[{id:'D',properties:{name:'城区'},geometry:{type:'Polygon',coordinates:[[[138.9,34.9],[139.1,34.9],[139.1,35.1],[138.9,35.1],[138.9,34.9]]]}}]};
  const p=projectMobility(source,{id:'sample'},geo);
  assert.equal(p.moves[0].id,'M1');assert.equal(p.summary.km,2);assert.equal(p.nodes[0].id,'A');assert.equal(p.nodes[0].cityId,'sample');
  assert.equal(source.nodes[0].cityId,undefined);
});

test('城市投影隐藏已由完整路线接替的中途边缘点，保留独立移动和城内轨迹',()=>{
  const outside=node('OUT',36,140),inside=node('IN',35,139),other=node('OTHER',35.02,139.01);
  const moves=[movement('COVERED',inside,outside),movement('FREE',inside,outside),movement('LOCAL',inside,other)];
  const source={...recon(moves),nodes:[outside,inside,other],visits:moves.flatMap(m=>[{id:m.fromVisitId,nodeId:m.fromNodeId,incoming:[],outgoing:[m.id]},{id:m.toVisitId,nodeId:m.toNodeId,incoming:[m.id],outgoing:[]}]),journeys:[],stationary:[]};
  const geo={features:[{id:'D',properties:{name:'城区'},geometry:{type:'Polygon',coordinates:[[[138.9,34.9],[139.1,34.9],[139.1,35.1],[138.9,35.1],[138.9,34.9]]]}}]};
  const projected=projectMobility(source,{id:'sample'},geo,[],{coveredBoundaries:new Set(['COVERED','LOCAL'])});
  assert.deepEqual(projected.moves.map(m=>m.id),['FREE','LOCAL']);
});

test('长途行程的分段观测由原全程计量；反向、另一次与离开走廊的移动保留',()=>{
  const d=node('D',35,139.25),e=node('E',35,139.7),off=node('OFF',36,139.7);
  const legs=[movement('PART1',d,e,{km:45,path:[[139.25,35],[139.7,35]],start:100,end:200}),
    movement('PART2',e,b,{km:30,path:[[139.7,35],[140,35]],start:250,end:400}),
    movement('REVERSE',e,d,{km:45,path:[[139.7,35],[139.25,35]],start:500,end:600}),
    movement('SECOND',d,e,{km:45,path:[[139.25,35],[139.7,35]],start:700,end:800}),
    movement('OFF',d,off,{km:150,path:[[139.25,35],[139.7,36]],start:900,end:1000})];
  const r=reconcileMobility([reference()],{nodes:[a,b,d,e,off],moves:legs,conflicts:[]});
  assert.equal(r.summary.coveredMoves,2);assert.equal(r.summary.additionalMoves,3);
  assert.equal(r.summary.totalKm,360);assert.equal(r.summary.refinedReferences,0);
  assert.ok(r.ownership.every(o=>o.action==='reference-partial-owns'));
});

test('月份或年度路线不能凭宽走廊吞掉通勤；没有完整端点时保留独立移动',()=>{
  const d=node('D',35,139.25),e=node('E',35,139.7);
  const m=movement('PART',d,e,{km:45,path:[[139.25,35],[139.7,35]]});
  const r=reconcileMobility([reference({endDate:'2024-12-31'})],{nodes:[a,b,d,e],moves:[m],conflicts:[]});
  assert.equal(r.summary.coveredMoves,0);assert.equal(r.summary.additionalMoves,1);
});

test('观测跨越既有长途的一部分，只增加未覆盖区间，计量拆分守恒',()=>{
  const before=node('BEFORE',35,138.8),middle=node('MID',35,139.5);
  const m=movement('OVERLAP',before,middle,{km:70,travelMinutes:100,path:[[138.8,35],[139.5,35]]});
  const r=reconcileMobility([reference()],{nodes:[a,b,before,middle],moves:[m],conflicts:[]});
  assert.equal(r.summary.partlyCoveredMoves,1);assert.equal(r.summary.totalKm,140);
  assert.equal(r.additions[0].km,20);assert.equal(r.additions[0].originalMoveKm,70);
  assert.equal(r.ownership[0].coveredKm+r.additions[0].km,m.km);
  assert.equal(r.reference[0].km,120);assert.equal(m.km,70);
});

test('机场附近同向高速定位片段由已发生航班计量，地面接驳与待飞航班不受影响',()=>{
  const before=node('APPROACH',35,140.4),near=node('NEAR',35,140.1),wrong=node('WRONG',35,140.5);
  const fast=movement('FAST',before,near,{km:27,start:10000,end:10300});
  const reverse=movement('REVERSE',near,wrong,{km:36,start:10400,end:10800});
  const ground=movement('GROUND',near,b,{km:10,start:11000,end:12200});
  const flight=reference({mode:'飞机',points:[[30,100],[35,140]],km:5000,distanceType:'archived',
    scheduledStart:1000,scheduledEnd:20000,status:'已飞'});
  const observed={nodes:[before,near,wrong,b],moves:[fast,reverse,ground],conflicts:[]};
  const result=reconcileMobility([flight],observed);
  assert.deepEqual(result.ownership.map(o=>[o.referenceId,o.moveIds[0],o.action]),[['R','FAST','flight-fragment-owns']]);
  assert.deepEqual(result.additions.map(m=>m.id),['MOB-REVERSE','MOB-GROUND']);
  assert.equal(result.summary.totalKm,5046);
  const planned=reconcileMobility([{...flight,status:'计划'}],observed);
  assert.equal(planned.summary.additionalMoves,3);
});

test('同一定位轨迹混有起降高速段时，只移除航班覆盖部分并保留地面接驳',()=>{
  const arrival={id:'ARRIVAL',date:'2024-01-01',start:10000,end:10760,
    points:[[140,34.9],[140,35],[140,35.05]],sampleTimes:[10000,10160,10760],sampleAccuracies:[5,5,5]};
  const departure={id:'DEPARTURE',date:'2024-01-01',start:20000,end:20760,
    points:[[139,35],[139,35.05],[139,35.15]],sampleTimes:[20000,20600,20760],sampleAccuracies:[5,5,5]};
  const flights=[reference({id:'IN',mode:'飞机',points:[[30,100],[35,140]],status:'已飞',scheduledStart:1000,scheduledEnd:10200}),
    reference({id:'OUT',mode:'飞机',points:[[35.05,139],[30,100]],status:'已飞',scheduledStart:20600,scheduledEnd:30000})];
  const evidence={tracks:[arrival,departure]};
  const trimmed=trimFlightTrackFragments(evidence,flights);
  assert.deepEqual(trimmed.evidence.tracks.map(t=>t.points),[arrival.points.slice(1),departure.points.slice(0,2)]);
  assert.deepEqual(trimmed.dispositions.map(d=>d.referenceIds[0]),['IN','OUT']);
  assert.equal(evidence.tracks[0].points.length,3);
  const planned=trimFlightTrackFragments(evidence,flights.map(f=>({...f,status:'计划'})));
  assert.deepEqual(planned.evidence.tracks,evidence.tracks);
  assert.equal(planned.dispositions.length,0);
  const wrongDirection={...arrival,points:[...arrival.points].reverse()};
  assert.equal(trimFlightTrackFragments({tracks:[wrongDirection]},[flights[0]]).dispositions.length,0);
  const otherTime={...flights[0],scheduledStart:30000,scheduledEnd:40000};
  assert.equal(trimFlightTrackFragments({tracks:[arrival]},[otherTime]).dispositions.length,0);
});

test('定位调整不能让维护中的移动编号指向另一段行程',()=>{
  const before={moves:[movement('M1',a,b,{evidenceReferences:['first']}),movement('M2',a,b,{evidenceReferences:['second']})]};
  const shifted={moves:[movement('M1',a,b,{evidenceReferences:['second']})]};
  assert.deepEqual([...unstableReconstructionDates(before,shifted)],['2024-01-01']);
  assert.equal(unstableReconstructionDates(before,{moves:before.moves.map(m=>({...m,km:1}))}).size,0);
});
