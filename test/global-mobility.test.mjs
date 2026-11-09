import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileMobility,effectiveMobilityRoutes,projectMobility} from '../scripts/global-mobility.mjs';

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
