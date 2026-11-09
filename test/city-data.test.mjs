import test from 'node:test';
import assert from 'node:assert/strict';
import {cityMovementMetadata,validateCityTripAccess,validateObservedCityRoute,loadCityMapResources} from '../scripts/city-data.mjs';
import {composeCity} from '../scripts/compose-city.mjs';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const row=()=>({'移动编号':'M1','发生依据':'同期活动及前后时间窗口复核','关联正文':'旅行正文.md','里程公里':'3','交通时长分钟':'14','里程依据':'距离模型','时长依据':'方式模型','记录类型':'活动移动','计程纳入':'是','里程类型':'model','时长类型':'model','线形类型':'model','核定结论':'合理重构','核定方式':'证据复核','证据引用':'旅行正文.md#实际回顾','核定记录':'确认活动次序；方式与数值为模型'});

test('可选城市背景缺失时保留边界与路线，缺边界给出安装入口',async()=>{
  const root=await mkdtemp(join(tmpdir(),'journey-city-map-'));
  const config={id:'sample',name:'示例城',boundaryFile:'sample-boundary.geojson',contextFile:'sample-context.geojson',landMaskFile:'sample-land.geojson'};
  try{
    await mkdir(join(root,'data'));
    await assert.rejects(loadCityMapResources(config,{root}),/sample-boundary\.geojson.*fetch-city-geography\.mjs sample/);
    const boundary={type:'FeatureCollection',features:[{type:'Feature',id:'TEST',geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}}]};
    await writeFile(join(root,'data',config.boundaryFile),JSON.stringify(boundary));
    const missing=await loadCityMapResources(config,{root});
    assert.deepEqual(missing.geo,boundary);assert.deepEqual(missing.context.features,[]);assert.equal(missing.context.unavailable,true);
    const context={type:'FeatureCollection',features:[],source:'公共道路源及署名'};
    await writeFile(join(root,'data',config.contextFile),JSON.stringify(context));
    assert.equal((await loadCityMapResources(config,{root})).context.source,context.source);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('城市移动必须保留发生、数值和来源的独立依据',()=>{
  const valid=cityMovementMetadata(row());assert.equal(valid.durationType,'model');assert.equal(valid.countDistance,true);assert.equal(valid.source,'旅行正文.md');
  for(const key of ['发生依据','关联正文','里程依据','时长依据'])assert.throws(()=>cityMovementMetadata({...row(),[key]:''}),/依据|正文/);
  assert.throws(()=>cityMovementMetadata({...row(),'时长类型':''}),/来源类型/);
  assert.throws(()=>cityMovementMetadata({...row(),'核定结论':'待核'}),/不能计程/);
});

test('区域接续可以未知距离与时长，但不能冒充精确移动',()=>{
  const coarse={...row(),'记录类型':'区域接续','计程纳入':'否','里程公里':'','交通时长分钟':'','里程类型':'unknown','时长类型':'unknown','线形类型':'unknown'};
  const valid=cityMovementMetadata(coarse);assert.equal(valid.km,null);assert.equal(valid.travelMinutes,null);assert.equal(valid.countDuration,false);
  assert.throws(()=>cityMovementMetadata({...coarse,'里程公里':'25'}),/不能冒充/);
  assert.throws(()=>cityMovementMetadata({...coarse,'线形类型':'model'}),/未知/);
});

test('城市每次到访的接续不能用另一年同地入出边补足',()=>{
  const a={id:'A',active:true,name:'实际景点'},hub={id:'H',active:false,name:'机场'},places=[a,hub];
  const routes=[{id:'M1',tripId:'T1',date:'2001-01-01',order:1,nodes:[hub,a]},{id:'M2',tripId:'T2',date:'2031-01-01',order:1,nodes:[a,hub]}];
  const trips=[{id:'T1',first:'2001-01-01',last:'2001-01-02',source:'2001正文.md'},{id:'T2',first:'2031-01-01',last:'2031-01-02',source:'2031正文.md'}];
  assert.throws(()=>validateCityTripAccess(places,routes,trips),/T1.*实际景点/);
  routes.push({id:'M3',tripId:'T1',date:'2001-01-02',order:2,nodes:[a,hub]});
  routes.unshift({id:'M4',tripId:'T2',date:'2031-01-01',order:.5,nodes:[hub,a],recordType:'区域接续'});
  const visits=validateCityTripAccess(places,routes,trips);assert.equal(visits.length,2);assert.equal(visits[0].coarse,false);assert.equal(visits[1].coarse,true);
});

test('同一城市行程多次回访同地分别记录，不能用晚到的入边补早离开的边',()=>{
  const a={id:'A',name:'公园',active:true},b={id:'B',name:'博物馆',active:true},h={id:'H',name:'枢纽',active:false};
  const sequence=[[h,a],[a,b],[b,a],[a,h]],routes=sequence.map((nodes,i)=>({id:'M'+i,nodes,tripId:'T',date:'2020-01-01',order:i+1}));
  const visits=validateCityTripAccess([a,b,h],routes,[{id:'T',first:'2020-01-01',last:'2020-01-01',source:'正文.md'}]);
  assert.equal(visits.length,3);assert.equal(visits.filter(v=>v.placeId==='A').length,2);
  assert.deepEqual(visits[0].incoming,['M0']);assert.deepEqual(visits[0].outgoing,['M1']);
});

test('实测城市路径必须同时绑定相同GPS窗口的公里、时长与形状',()=>{
  const track={id:'GPS1',points:[[139,35],[139.01,35]],sampleTimes:[100,160],sampleCumulativeKm:[0,1.1],sampleAccuracies:[5,6]},evidence={tracks:[track]};
  const route={id:'M',geometryType:'observed',distanceType:'observed',durationType:'observed',trackId:'GPS1',observedStart:100,observedEnd:160,km:1.1,travelMinutes:1,path:track.points};
  assert.doesNotThrow(()=>validateObservedCityRoute(route,evidence));
  assert.throws(()=>validateObservedCityRoute({...route,km:.1},evidence),/公里或时长/);
  assert.throws(()=>validateObservedCityRoute({...route,durationType:'model'},evidence),/公里或时长/);
  assert.throws(()=>validateObservedCityRoute({...route,observedEnd:200},evidence),/GPS窗口/);
});

test('城市编排不能自动核定到访、交通方式或证据结论',()=>{
  const a={id:'A',name:'机场',lat:35,lon:139,visit:false},b={id:'B',name:'公园',lat:35.01,lon:139.01,visit:true};
  const options={config:{id:'sample'},geometry:{features:[]},evidence:{tracks:[],photos:[],stays:[],summary:{}},parentPlaceId:'P',places:{a,b},journeys:[{id:'T',name:'某次',source:'正文.md',basis:'活动次序已核',days:[['2020-01-01',['a','b','a']]]}]};
  assert.throws(()=>composeCity(options),/先完成明确核定/);
});

test('城市编排采用实测片段的公里和时长，并完整保留证据元数据',()=>{
  const date='2030-04-10',start=Date.parse(date+'T01:00:00Z')/1000,review={reviewMethod:'证据复核',reviewRecord:'正文活动与时序复核',evidenceReferences:['正文.md#回顾']};
  const a={id:'A',name:'机场',lat:30.00,lon:20.00,visit:false,...review,conclusion:'交通接触'},b={id:'B',name:'公园',lat:30.00,lon:20.0211,visit:true,...review,conclusion:'地面到访'};
  const track={id:'GPS1',date,timeZone:'Asia/Tokyo',start,end:start+600,points:[[20.00,30.00],[20.01055,30.00],[20.0211,30.00]],sampleTimes:[start,start+300,start+600],sampleAccuracies:[5,7,5],sampleCumulativeKm:[0,1.1,2.2],samples:3};
  const patch=composeCity({config:{id:'sample',timeZone:'Asia/Tokyo'},geometry:{features:[{id:'D1',geometry:{type:'Polygon',coordinates:[[[19,29],[21,29],[21,31],[19,31],[19,29]]]}}]},evidence:{tracks:[track],photos:[],stays:[],summary:{}},parentPlaceId:'P',places:{a,b},journeys:[{id:'T',name:'某次',source:'正文.md',basis:'活動順序已核',...review,conclusion:'合理重构',days:[[date,['a','b','a']]]}]});
  assert.equal(patch.cityMoves[0]['里程公里'],2.2);assert.equal(patch.cityMoves[0]['交通时长分钟'],10);assert.equal(patch.cityMoves[0]['里程类型'],'observed');
  assert.equal(patch.cityMoves[1]['里程类型'],'model');assert.deepEqual(patch.cityEvidence.sample.tracks[0].sampleTimes,track.sampleTimes);
  assert.equal(patch.cityMoves[0]['GPS开始时间'],start);assert.equal(patch.cityMoves[0]['GPS结束时间'],start+600);
  const repeated=composeCity({config:{id:'sample',timeZone:'Asia/Tokyo'},geometry:{features:[{id:'D1',geometry:{type:'Polygon',coordinates:[[[19,29],[21,29],[21,31],[19,31],[19,29]]]}}]},evidence:{tracks:[track],photos:[],stays:[],summary:{}},parentPlaceId:'P',places:{a,b},journeys:[{id:'T',name:'重复访问',source:'正文.md',basis:'活动顺序已核',...review,conclusion:'合理重构',days:[[date,['a','b','a','b','a']]]}]});
  assert.equal(repeated.cityMoves.filter(r=>r['GPS轨迹编号']==='GPS1').length,1,'同一个原始GPS窗口只能消费一次');
});
