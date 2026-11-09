import test from 'node:test';
import assert from 'node:assert/strict';
import {reconstructCity,movingWindows,validateCityReconstruction} from '../scripts/reconstruct-city.mjs';
import {createScopeEngine} from '../src/scope-model.mjs';

const start=Date.parse('2024-01-02T00:00:00Z')/1000;
const config={id:'sample',country:'甲国',timeZone:'Asia/Tokyo'};
const geometry={features:[{id:'D',properties:{name:'城区'},geometry:{type:'Polygon',coordinates:[[[138,34],[140,34],[140,36],[138,36],[138,34]]]}}]};
const gps=(p,t)=>({id:'GPS',date:'2024-01-02',points:p,sampleTimes:t.map(n=>start+n*60),sampleAccuracies:p.map(()=>5),start,end:start+t.at(-1)*60});
const reconstruct=evidence=>reconstructCity({config,geometry,evidence});

test('停留切开连续GPS，窗口耗时不直接变成交通时间，回访有独立访问身份',()=>{
  const track=gps([[139,35],[139.01,35],[139.01,35],[139.01,35],[139.01,35],[139,35]],[0,5,10,20,25,30]);
  const windows=movingWindows(track);assert.equal(windows.length,2);assert.equal(windows.reduce((s,w)=>s+w.minutes,0),10);
  const r=reconstruct({tracks:[track]});assert.equal(r.moves.length,2);assert.equal(r.summary.travelMinutes,10);
  assert.equal(r.visits[0].nodeId,r.visits.at(-1).nodeId);assert.notEqual(r.visits[0].id,r.visits.at(-1).id);
  assert.doesNotThrow(()=>validateCityReconstruction(r));
});

test('照片-only城市按时间恢复移动、距离与时间，间隔不当交通耗时，观测不晋级景点',()=>{
  const photoPoints=[{uuid:'P1',time:start,lon:139,lat:35},{uuid:'P2',time:start+3*3600,lon:139.02,lat:35},{uuid:'P3',time:start+5*3600,lon:139,lat:35}];
  const r=reconstruct({photoPoints});assert.equal(r.moves.length,2);assert.equal(r.journeys.length,1);
  assert.ok(r.moves[0].travelMinutes<r.moves[0].windowMinutes);assert.equal(r.moves[0].distanceType,'model');assert.equal(r.moves[0].geometryType,'model');
  assert.ok(r.nodes.every(n=>!n.active&&!n.visited));assert.doesNotThrow(()=>validateCityReconstruction(r));
  assert.deepEqual(r.visits[1].incoming,[r.moves[0].id]);assert.deepEqual(r.visits[1].outgoing,[r.moves[1].id]);
});

test('短时GPS抖动不计为移动，静止观测与真实移动分开',()=>{
  const track=gps([[139,35],[139.0001,35],[139,35],[139.0001,35]],[0,10,20,30]);
  const r=reconstruct({tracks:[track]});assert.equal(r.moves.length,0);assert.equal(r.summary.stationaryTracks,1);assert.equal(r.summary.stationaryVisits,1);
});

test('高频铁路定位的交通分钟不被六秒最小值扩大，始终落在观测窗口内',()=>{
  const track=gps([[139,35],[139.003,35]],[0,4/60]);
  const r=reconstructCity({config:{...config,maxSpeed:320,regional:true},geometry,evidence:{tracks:[track]}});
  assert.equal(r.moves.length,1);assert.ok(r.moves[0].travelMinutes<=4/60+.001);
  assert.doesNotThrow(()=>validateCityReconstruction(r));
});

test('跨午夜接续保留原时间范围和端点，长期资料间隔不造往返',()=>{
  const day=Date.parse('2024-01-02T14:00:00Z')/1000;
  const r=reconstruct({photoPoints:[{uuid:'A',time:day,lon:139,lat:35},{uuid:'B',time:day+3*3600,lon:139.02,lat:35},{uuid:'C',time:day+30*86400,lon:139.04,lat:35}]});
  assert.equal(r.moves.length,1);assert.equal(r.moves[0].startDate,'2024-01-02');assert.equal(r.moves[0].endDate,'2024-01-03');
  assert.equal(r.summary.stationaryVisits,1);assert.ok(r.visits[0].boundary);assert.ok(r.visits[1].boundary);assert.doesNotThrow(()=>validateCityReconstruction(r));
});

test('完整观测不修改原始记录；不能复制GPS窗口计程',()=>{
  const evidence={tracks:[gps([[139,35],[139.01,35],[139.02,35]],[0,5,10])]},before=JSON.stringify(evidence),r=reconstruct(evidence);
  assert.equal(JSON.stringify(evidence),before);assert.doesNotThrow(()=>validateCityReconstruction(r));
  const duplicate={...r.moves[0],id:'COPY'};r.moves.push(duplicate);r.visits[0].outgoing.push('COPY');r.visits[1].incoming.push('COPY');
  assert.throws(()=>validateCityReconstruction(r),/重复计量/);
});

test('城市查询和统计来自推断移动，人工示意不重复计量，全球与旅游覆盖不变',()=>{
  const r=reconstruct({tracks:[gps([[139,35],[139.01,35],[139.02,35]],[0,5,10])]}),nodes=new Map(r.nodes.map(n=>[n.id,n]));
  const inferredRoutes=r.moves.map(m=>({...m,reconstructed:true,nodes:[nodes.get(m.fromNodeId),nodes.get(m.toNodeId)]}));
  const old={id:'manual',date:'2024-01-02',tripId:'T',mode:'市内交通',km:100,travelMinutes:60,nodes:inferredRoutes[0].nodes};
  const data={meta:{totalKm:999,flightMinutes:60,nodes:2},scopes:[{id:'world',level:'world',countries:['甲国'],units:[]},{id:'city:sample',level:'city',cityId:'sample',parent:'world',countries:['甲国'],units:[{id:'D',name:'城区'}]}],routes:[],places:[],cities:{sample:{places:[],routes:[old],inferredRoutes,trips:[{id:'T',first:'2024-01-02',last:'2024-01-02'}]}}};
  const engine=createScopeEngine(data),view=engine.query('city:sample');
  assert.equal(view.stats.km,Math.round(r.summary.km*10)/10);assert.equal(view.stats.travelMinutes,10);
  assert.equal(view.stats.places,0);assert.equal(view.stats.visited,0);assert.equal(engine.query('world').stats.km,999);
  assert.equal(engine.query('city:sample',{tripId:'T'}).reconstruction.moves,1);
});
