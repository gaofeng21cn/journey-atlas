import test from 'node:test';
import assert from 'node:assert/strict';
import {locationLayer,journeyLayer,journeySummaryRows,seedJourneys,allocateMeters,allocateKm,trajectoryRows,trajectorySummary,journeyClosure,journeyDateViolations,routePoints,routeNames,orderLegs,routeTime,joinsChain} from '../scripts/travel-layers.mjs';
import {hubConnectors} from '../scripts/hub-links.mjs';
import {readGround} from '../scripts/atlas-data.mjs';
import {splitPlacePatches} from '../scripts/update-atlas.mjs';
const places=locationLayer([{id:'A',name:'Origin Point',prefectureId:'13',status:'已到访',lat:10,lon:10},{id:'B',name:'Candidate Point',prefectureId:'04',status:'待核',lat:20,lon:20}],[]);
const transport={id:'GT1',date:'2031',include:true,mode:'铁路',names:['Origin Point','Candidate Point','Origin Point'],points:[[10,10],[20,20],[10,10]],km:780,countries:['日本'],source:'trip.md',status:'合理推定',nodePlaceIds:['A','B','A']};
const journey={行程编号:'J1',行程名称:'Candidate Point往返',出发基地地点编号:'A',重构状态:'合理重构',行程依据:'出发点与活动顺序',关联正文:'trip.md',关联交通编号:'GT1',分享纳入:'纳入'};
const row={交通编号:'GT1',日期或区间:'2031',交通方式:'铁路',地点编号序列:'A；B；A',距离模型:'rail',里程公里:'',分享纳入:'纳入',关联正文:'trip.md',发生依据:'据点与地面活动支持',发生状态:'合理推定'};

test('地点引用实时解析坐标和模型里程；不会把沿途候选变成到访',()=>{
  const old=readGround([row],places.index)[0];
  const changed=new Map(places.index);changed.set('B',{...changed.get('B'),lat:39});
  const next=readGround([row],changed)[0];
  assert.notDeepEqual(old.points,next.points);assert.notEqual(old.km,next.km);
  assert.equal(places.index.get('B').status,'待核');
  assert.equal(old.names.join('→'),'Origin Point→Candidate Point→Origin Point');
  assert.throws(()=>readGround([{...row,里程公里:'780'}],places.index),/不同时填手工公里/);
  assert.throws(()=>readGround([{...row,地点编号序列:'A；missing'}],places.index),/不存在/);
  assert.throws(()=>readGround([{...row,距离模型:'road'}],places.index),/对应方式/);
});
test('一个交通只有一个行程owner；整体排除不抹去事实，未归组新票不丢失',()=>{
  const layer=journeyLayer([journey],[transport],places);
  assert.equal(layer.routes.length,1);assert.equal(layer.routes[0].journeyId,'J1');assert.equal(layer.journeys[0].base,'Origin Point');
  assert.throws(()=>journeyLayer([journey,{...journey,行程编号:'J2'}],[transport],places),/一个行程/);
  assert.throws(()=>journeyLayer([{...journey,关联交通编号:'unknown'}],[transport],places),/不存在/);
  const excluded=journeyLayer([{...journey,分享纳入:'排除'}],[transport],places);
  assert.equal(excluded.routes.length,0);assert.equal(excluded.journeys[0].transport.length,1);assert.equal(journeySummaryRows(excluded)[0]['已计里程公里'],0);
  const pending=journeyLayer([], [transport],places);assert.equal(pending.unassigned.length,1);assert.equal(pending.routes.length,1);
  assert.equal(transport.include,true);
});
test('未知里程保持空值，路线断点单列而不造连接；基地随地点名称更新',()=>{
  const r2={...transport,id:'GT2',names:['Candidate Point','Destination Point'],points:[[20,20],[21,21]],km:null};
  const layer=journeyLayer([{...journey,关联交通编号:'GT1；GT2'}],[{...transport,km:null},r2],places);
  const summary=journeySummaryRows(layer)[0];
  assert.equal(summary['已计里程公里'],'');assert.equal(summary['缺里程路线数'],2);assert.match(summary['接续待核'],/Origin Point → Candidate Point/);
  const renamed=locationLayer([{...places.places[0],name:'Origin Area'}],[]);
  assert.equal(journeyLayer([journey],[transport],renamed).journeys[0].base,'Origin Area');
});
test('统一地点补丁支持日本，原人工依据不被适配层删改，跨表身份冲突拒绝',()=>{
  const patch={地点编号:'A',国家代码:'JP',国家地区:'日本','城市/地点':'示例城市',一级区域代码:'JP-13',核定依据:'本人确认',分享纳入:'纳入'};
  const out=splitPlacePatches([patch],new Set(['A']),[['13','示例城市都']]);
  assert.deepEqual(out.japanPlaces,[{地点编号:'A','城市/城镇':'示例城市',都道府县代码:'13',都道府县:'示例城市都',核定依据:'本人确认',分享纳入:'纳入'}]);
  assert.throws(()=>splitPlacePatches([{...patch,国家代码:'US'}],new Set(['A'])),/冲突/);
  assert.throws(()=>locationLayer([{...places.places[0]}],[{...places.places[0]}]),/跨表/);
});
test('来源归组保留未知细节，首次整理不自动确认为完整旅行',()=>{
  const rows=seedJourneys([transport],places.places);
  assert.equal(rows[0]['重构状态'],'来源归组');assert.equal(rows[0]['出发基地'],'');
  assert.equal(rows[0]['关联交通编号'],'GT1');
});
test('同日多段按端点衔接排序，不把“City Alpha→City Beta→City Gamma”误读成反序',()=>{
  const leg=(id,names,points)=>({...transport,id,names,points,km:1});
  const a=leg('F2',['City Alpha','City Beta'],[[20,20],[21,21]]);
  const b=leg('F1',['City Beta','City Gamma'],[[21,21],[22,22]]);
  const layer=journeyLayer([{...journey,关联交通编号:'F2；F1'}],[a,b],places);
  const summary=journeySummaryRows(layer)[0];
  assert.match(summary['路线片段'],/City Alpha → City Beta.*City Beta → City Gamma/);
  assert.equal(summary['接续待核'],'');
  const reverse=journeySummaryRows(journeyLayer([{...journey,关联交通编号:'F1；F2'}],[b,a],places))[0];
  assert.match(reverse['路线片段'],/City Alpha → City Beta.*City Beta → City Gamma/);
});

test('节点入出度平衡不能证明两个不连通日游有行程接续',()=>{
  const a={...transport,id:'LOOP-A',names:['Origin Point','Candidate Point','Origin Point'],points:[[10,10],[20,20],[10,10]],date:'2031-01-01'};
  const b={...transport,id:'LOOP-B',names:['Coasttown','Hilltown','Coasttown'],points:[[15,25],[16,26],[15,25]],date:'2031-01-02'};
  const j={id:'J-LOOP',transport:[a,b]};
  const closure=journeyClosure([j],new Map());
  assert.equal(closure.balanced,true);assert.equal(closure.connected,false);assert.equal(closure.closed,false);
  assert.equal(closure.components.length,2);
  assert.deepEqual(journeyDateViolations([{id:'J-LOOP',date:'2031',transport:[{...a,date:'2029-12-31'}]}]),[
    {journey:'J-LOOP',transport:'LOOP-A',date:'2029-12-31',scope:'2031'}
  ]);
});

test('路线按整数米拆分、公里仅换算展示，保留总量且不出现零距离段',()=>{
  assert.deepEqual(allocateKm(10,[1,1]),[5,5]);
  assert.deepEqual(allocateKm(9,[1,1]),[4.5,4.5]);
  assert.deepEqual(allocateKm(1,[1,1]),[0.5,0.5]);
  assert.deepEqual(allocateMeters(1000,[1,1]),[500,500]);
  assert.deepEqual(allocateMeters(1000,[0,0,0]),[334,333,333]);
  assert.deepEqual(allocateMeters(1000,[100,0,0]),[998,1,1]);
  assert.throws(()=>allocateMeters(1,[1,1]),/总米数/);
  assert.equal(allocateKm(3,[0,0]).join(','),'1.5,1.5');
  for(const [km,weights]of [[1,[1,1,1]],[3,[0,0,0]],[4,[100,0,0]],[2,[0,0,0,0]]]){
    const parts=allocateKm(km,weights);
    assert.ok(parts.every(v=>v>0));
    assert.ok(Math.abs(parts.reduce((s,v)=>s+v,0)-km)<1e-9);
  }
  const parts=allocateKm(253,[130,60,60]);
  assert.equal(parts.reduce((s,v)=>s+v,0),253);assert.ok(parts.every(v=>v>0));
});
test('轨迹层按日期接续路线，同日多段就近重排，断点如实标注而不是补线',()=>{
  const leg=(id,names,points,km)=>({...transport,id,names,points,km});
  const a=leg('F2',['City Alpha','City Beta'],[[20,20],[21,21]],800);
  const b=leg('F1',['City Beta','City Gamma'],[[21,21],[22,22]],600);
  const c=leg('GT9',['City Delta','City Alpha'],[[19,19],[20,20]],60);
  const layer=journeyLayer([{...journey,关联交通编号:'F2；F1；GT9'}],[a,b,c],places);
  const rows=trajectoryRows(layer.routes,layer.journeys);
  assert.deepEqual(rows.map(r=>`${r['出发地']}→${r['到达地']}`),['City Delta→City Alpha','City Alpha→City Beta','City Beta→City Gamma']);
  assert.deepEqual(rows.map(r=>r['接续状态']),['链条起点','连续','连续']);
  assert.equal(rows.reduce((s,r)=>s+r['里程公里'],0),1460);
  assert.equal(rows.reduce((s,r)=>s+r['里程米'],0),1460000);
  assert.ok(rows.every(r=>Number.isInteger(r['里程米'])&&r['里程公里']===r['里程米']/1000));
  assert.equal(trajectorySummary(rows).breaks,0);
  const broken=trajectoryRows(layer.routes,layer.journeys.filter(j=>false));
  assert.equal(broken[0]['接续状态'],'链条起点');
});

test('轨迹事实保持机场坐标，绘图仍可使用服务城市显示节点',()=>{
  const a={...transport,id:'FA',date:'2030-05-26',mode:'飞机',names:['Airport Alpha','Airport Beta'],displayNames:['City Alpha','City Beta'],points:[[10,20],[30,40]],displayPoints:[[10.1,20.1],[30.1,40.1]],km:1000};
  const b={...transport,id:'FB',date:'2030-05-26',mode:'飞机',names:['Airport Beta','Airport Gamma'],displayNames:['City Beta','City Gamma'],points:[[30,40],[50,60]],displayPoints:[[30.1,40.1],[50.1,60.1]],km:300};
  const layer=journeyLayer([{...journey,关联交通编号:'FA；FB'}],[a,b],places);
  const rows=trajectoryRows(layer.routes,layer.journeys);
  assert.deepEqual(rows.map(r=>`${r['出发地']}→${r['到达地']}`),['Airport Alpha→Airport Beta','Airport Beta→Airport Gamma']);
  assert.deepEqual(rows.map(r=>r['接续状态']),['链条起点','连续']);
  assert.deepEqual([rows[0]['到达纬度'],rows[0]['到达经度']],[30,40]);
  assert.deepEqual(routePoints(a),a.displayPoints);assert.deepEqual(routeNames(a),a.displayNames);
});

const hubFlight = (id, names, points, date) => ({ ...transport, id, names, cities: names, points, date, km: 1000, mode: '飞机' });
const hubJourney = (id, ref, date) => ({ 行程编号: id, 行程名称: id, 日期或区间: date, 重构状态: '来源归组', 行程依据: 'x', 关联正文: '旅行.md', 关联交通编号: ref, 分享纳入: '纳入' });
const hubBreak = () => [
  hubFlight('H1', ['Hub Alpha', 'Hub Beta'], [[10, 10], [20, 20]], '2030-01-01'),
  hubFlight('H2', ['Hub Gamma', 'Hub Delta'], [[30, 30], [40, 40]], '2030-01-08'),
];

test('相邻枢纽候选提示缺失接续，不发明方式和公里也不证明连续', () => {
  const layer = journeyLayer([hubJourney('JA', 'H1', '2030-01-01'), hubJourney('JB', 'H2', '2030-01-08')], hubBreak(), places);
  const draft = trajectoryRows(layer.routes, layer.journeys);
  assert.equal(trajectorySummary(draft).breaks, 1);
  const links = hubConnectors(draft, layer.routes, { places: places.places });
  assert.equal(links.length, 1);
  assert.equal(links[0].candidate,true);assert.equal(links[0].km,null);
  const chained = trajectoryRows(layer.routes, layer.journeys, { connectors: links });
  assert.equal(trajectorySummary(chained).breaks, 0);
  assert.equal(trajectorySummary(chained).unrestoredTransitions,1);
  assert.equal(chained.filter(r => r['接续类型'] === '待还原接续').length, 1);
  assert.equal(chained.find(r=>r['接续类型']==='待还原接续')['接续状态'],'待核');
  assert.equal(trajectorySummary(chained).km,2000);
});
test('别次同城市对移动不能被借作链内已覆盖', () => {
  const draft = [
    { 轨迹序号: 1, 日期: '2030-01-01', 出发地: 'Hub Alpha', 到达地: 'Hub Beta', 出发纬度: 10, 出发经度: 10,
      到达纬度: 20, 到达经度: 20, 交通方式: '飞机', 里程公里: 1900, 接续状态: '链条起点', 接续类型: '旅行', 所属行程编号: 'JA', 关联正文: 'a.md' },
    { 轨迹序号: 2, 日期: '2030-01-08', 出发地: 'Hub Gamma', 到达地: 'Hub Delta', 出发纬度: 30, 出发经度: 30,
      到达纬度: 40, 到达经度: 40, 交通方式: '飞机', 里程公里: 9500, 接续状态: '断点', 接续类型: '旅行', 所属行程编号: 'JB', 关联正文: 'b.md' },
  ];
  const links = hubConnectors(draft, [hubFlight('H3', ['Hub Beta', 'Hub Gamma'], [[20, 20], [30, 30]], '2030-01-07')], { places: places.places });
  assert.equal(links.length, 1);
  assert.equal(links[0].covered,undefined);
  assert.equal(links[0].candidate,true);assert.equal(links[0].km,null);
});

test('显式同日段序不可被几何重排，矛盾留在审计字段',()=>{
  const a={...transport,id:'a',date:'2020-01-01',sequence:1,names:['B','C'],points:[[0,1],[0,2]]};
  const b={...transport,id:'b',date:'2020-01-01',sequence:2,names:['A','B'],points:[[0,0],[0,1]]};
  const ordered=orderLegs([b,a]);assert.deepEqual(ordered.map(r=>r.id),['a','b']);
  const rows=trajectoryRows([b,a],[{id:'J',transport:[b,a]}]);
  assert.deepEqual(rows.map(r=>r['交通编号']),['a','b']);assert.equal(rows[1]['接续状态'],'断点');
  assert.ok(rows.every(r=>r['排序依据']==='显式段序'));assert.match(rows[1]['排序问题'],/登记端点未接续/);
});

test('合法登记次序优先，不因距离更近跳过已登记往返',()=>{
  const a={...transport,id:'a',date:'2020-01-01',names:['A','B'],points:[[0,0],[0,1]]};
  const loop={...transport,id:'loop',date:'2020-01-01',names:['B','X','B'],points:[[0,1],[1,1],[0,1]]};
  const b={...transport,id:'b',date:'2020-01-01',names:['B','C'],points:[[0,1],[0,2]]};
  const rows=trajectoryRows([a,b,loop],[{id:'J',transport:[a,loop,b]}]);
  assert.deepEqual(rows.map(r=>r['交通编号']),['a','loop','loop','b']);
  assert.ok(rows.every(r=>r['排序依据']==='登记顺序'));
});

test('地面部分编号不把未编号进出航空排到旅行结束后',()=>{
  const flightIn={...transport,id:'in',date:'2020-01-01',mode:'飞机',names:['海外','A'],points:[[0,-1],[0,0]],sequence:null};
  const ground={...transport,id:'ground',date:'2020-01-02',mode:'铁路',names:['A','B'],points:[[0,0],[0,1]],sequence:1};
  const flightOut={...transport,id:'out',date:'2020-01-03',mode:'飞机',names:['B','海外'],points:[[0,1],[0,-1]],sequence:null};
  const j={id:'J',transport:[flightIn,ground,flightOut]};
  assert.deepEqual(orderLegs(j.transport).map(r=>r.id),['in','ground','out']);
  const rows=trajectoryRows([ground,flightOut,flightIn],[j]);
  assert.deepEqual(rows.map(r=>r['交通编号']),['in','ground','out']);
  assert.ok(rows.every(r=>r['排序问题']===''));assert.equal(journeyClosure([j]).closed,true);
});

test('部分编号只在同窗口排序编号槽位，不能猜未编号航段的位置',()=>{
  const a={...transport,id:'a',date:'2020-01-01',names:['A','B'],points:[[0,0],[0,1]],sequence:null};
  const first={...transport,id:'first',date:'2020-01-01',names:['B','C'],points:[[0,1],[0,2]],sequence:1};
  const middle={...transport,id:'middle',date:'2020-01-01',names:['C','D'],points:[[0,2],[0,3]],sequence:null};
  const second={...transport,id:'second',date:'2020-01-01',names:['D','E'],points:[[0,3],[0,4]],sequence:2};
  const last={...transport,id:'last',date:'2020-01-02',names:['E','A'],points:[[0,4],[0,0]],sequence:1};
  const ordered=orderLegs([a,second,middle,first,last]);
  assert.deepEqual(ordered.map(r=>r.id),['a','first','middle','second','last']);
  assert.ok(ordered.every(r=>r.orderBasis==='部分段序与时间登记'));
  assert.ok(ordered.every(r=>!r.orderIssues.length));
});

test('同城不同机场以及相距几公里的同名点必须保留移动缺口',()=>{
  const aliases=new Map([['East Airport','Metro Alpha'],['West Airport','Metro Alpha']]);
  assert.equal(joinsChain({lat:10.2,lon:20.4,name:'East Airport'},{point:[10.1,19.9],name:'West Airport'},{aliases}).joined,false);
  assert.equal(joinsChain({lat:0,lon:0,name:'城市'},{point:[0,0.04],name:'城市'}).joined,false);
  assert.equal(joinsChain({lat:0,lon:0},{point:[0,0.0003]}).joined,true);
  const a={...transport,id:'a',date:'2020-01-01',names:['A','机场'],points:[[0,1],[0,0]],displayNames:['A','城市'],displayPoints:[[0,1],[1,1]]};
  const b={...transport,id:'b',date:'2020-01-01',names:['市区','B'],points:[[0,0.04],[0,2]],displayNames:['城市','B'],displayPoints:[[1,1],[0,2]]};
  assert.equal(trajectoryRows([a,b],[])[1]['接续状态'],'断点');
});

test('区间时间键保留在每段，不把中途节点精确到路线起日',()=>{
  const r={...transport,date:'2020-06-30 — 2020-07-03',startDate:'2020-06-30',endDate:'2020-07-03',timePrecision:'区间'};
  const rows=trajectoryRows([r],[]);
  assert.equal(rows.length,2);assert.ok(rows.every(row=>row['开始日期']==='2020-06-30'&&row['结束日期']==='2020-07-03'&&row['时间精度']==='区间'));
  assert.deepEqual(routeTime({date:'2020-10—11'}),{startDate:'2020-10',endDate:'2020-11',timePrecision:'区间',sequence:null});
  const j={id:'J',date:'2020-07-01 — 2020-07-03',transport:[{...r,date:'2020-07-02'}]};
  assert.equal(journeyDateViolations([j])[0].date,'2020-06-30 — 2020-07-03');
});

test('相同城市对候选只能消费绑定的前后交通段',()=>{
  const a={...transport,id:'a',date:'2020-01-01',names:['A','B'],points:[[0,0],[0,1]]};
  const b={...transport,id:'b',date:'2020-01-01',names:['C','D'],points:[[0,2],[0,3]]};
  const c={id:'H',fromName:'B',toName:'C',from:[0,1],to:[0,2],candidate:true,km:null,mode:'待定',previousTransport:'different',nextTransport:'b',previousSegment:1,nextSegment:1};
  assert.equal(trajectoryRows([a,b],[],{connectors:[c]}).length,2);
  const rows=trajectoryRows([a,b],[],{connectors:[{...c,previousTransport:'a'}]});
  assert.equal(rows.length,3);assert.equal(rows[1]['接续类型'],'待还原接续');assert.equal(rows[2]['接续状态'],'待还原');
  assert.throws(()=>trajectoryRows([a,b],[],{connectors:[{...c,previousTransport:'a',candidate:false,covered:true,coveredSegments:[{transport:'a',segment:1}]}]}),/须恢复真实交通段顺序/);
});

test('入出度平衡但显式时间反序不能核定闭环',()=>{
  const a={...transport,id:'a',date:'2020-01-02',sequence:1,names:['A','B'],points:[[0,0],[0,1]]};
  const b={...transport,id:'b',date:'2020-01-01',sequence:2,names:['B','A'],points:[[0,1],[0,0]]};
  const closure=journeyClosure([{id:'J',transport:[a,b]}]);
  assert.equal(closure.balanced,true);assert.equal(closure.connected,true);assert.equal(closure.temporal,false);assert.equal(closure.closed,false);
});

test('维护的未知结构LINK接上拓扑但不升级历史连续和计程',()=>{
  const a={...transport,id:'a',date:'2020-01-01',km:100,names:['A','B'],points:[[0,0],[0,1]]};
  const b={...transport,id:'b',date:'2020-01-02',km:100,names:['C','A'],points:[[0,2],[0,0]]};
  const link={...transport,id:'LINK',date:'2020-01-01 — 2020-01-02',names:['B','C'],points:[[0,1],[0,2]],
    recordType:'接驳段',previousTransport:'a',nextTransport:'b',previousSegment:1,nextSegment:1,structuralLink:true,countDistance:false,mode:'交通方式待定',km:500};
  const j={id:'J',transport:[a,link,b],transportIds:['a','LINK','b'],include:true};
  const rows=trajectoryRows([a,link,b],[j]);
  assert.deepEqual(rows.map(r=>r['交通编号']),['a','LINK','b']);
  assert.deepEqual(rows.map(r=>r['接续状态']),['链条起点','待核','待还原']);
  assert.equal(rows[1]['发生状态'],'待还原');assert.equal(rows[1]['里程公里'],'');
  assert.equal(trajectorySummary(rows).km,200);
  assert.equal(journeyClosure([j]).closed,false);
  const summary=journeySummaryRows({journeys:[j],aliases:new Map()})[0];
  assert.equal(summary['已计里程公里'],200);assert.match(summary['接续待核'],/尚未还原/);
});

test('资料间隔只能投影成待还原连接，不能混入普通移动或构造闭环',()=>{
  const a={...transport,id:'a',date:'2020-01-01',km:100,names:['A','B'],points:[[0,0],[0,1]]};
  const b={...transport,id:'b',date:'2020-01-03',km:100,names:['C','A'],points:[[0,2],[0,0]]};
  const gap={...transport,id:'GAP',date:'未还原',startDate:'2020-01-01',endDate:'2020-01-03',
    names:['B','C'],points:[[0,1],[0,2]],recordType:'资料间隔',previousTransport:'a',nextTransport:'b',previousSegment:1,nextSegment:1,
    structuralLink:true,countDistance:false,km:9999,mode:'交通方式待定'};
  const j={id:'J',transport:[a,gap,b],transportIds:['a','GAP','b'],include:true};
  const rows=trajectoryRows([a,gap,b],[j]);
  assert.equal(rows.find(r=>r['交通编号']==='GAP')['路线段'],'接驳');
  assert.equal(rows.find(r=>r['交通编号']==='GAP')['接续类型'],'资料间隔');
  assert.equal(rows.find(r=>r['交通编号']==='b')['接续状态'],'待还原');
  assert.equal(trajectorySummary(rows).km,200);assert.equal(journeyClosure([j]).closed,false);
  assert.doesNotThrow(()=>journeySummaryRows({journeys:[j],aliases:new Map()}));
});

test('跨行程接驳的局部汇总不抛错且不假定前后链已核定',()=>{
  const a={...transport,id:'a',date:'2020-01-01',km:100,names:['A','B'],points:[[0,0],[0,1]]};
  const b={...transport,id:'b',date:'2020-01-02',km:100,names:['C','A'],points:[[0,2],[0,0]]};
  const link={...transport,id:'LINK',date:'2020-01-01 — 2020-01-02',names:['B','C'],points:[[0,1],[0,2]],
    recordType:'接驳段',previousTransport:'a',nextTransport:'b',km:100};
  const first={id:'J1',transport:[a,link],transportIds:['a','LINK'],include:true};
  const closure=journeyClosure([first]);assert.equal(closure.closed,false);assert.equal(closure.continuous,false);
  const summary=journeySummaryRows({journeys:[first],aliases:new Map()})[0];
  assert.match(summary['接续待核'],/全局轨迹核对/);
  assert.throws(()=>trajectoryRows([a,link],[first]),/接驳前后交通不存在/);
  const global=trajectoryRows([a,link,b],[first,{id:'J2',transport:[b]}]);
  assert.deepEqual(global.map(r=>r['交通编号']),['a','LINK','b']);
  assert.deepEqual(global.map(r=>r['接续状态']),['链条起点','连续','连续']);
});

test('未知结构边不能凭全段同点或原始已确认文字核定闭环',()=>{
  const loop={...transport,id:'loop',date:'2020-01-01',km:100,names:['A','B','A'],points:[[0,0],[0,1],[0,0]]};
  const loop2={...transport,id:'loop2',date:'2020-01-01',km:100,names:['A','C','A'],points:[[0,0],[0,2],[0,0]]};
  const unknown={...transport,id:'UNKNOWN',date:'2020-01-01',names:['A','A'],points:[[0,0],[0,0]],
    countDistance:false,structuralLink:true,status:'本人确认',km:500,recordType:'接驳段',previousTransport:'loop',nextTransport:'loop2',previousSegment:2,nextSegment:1};
  const j={id:'J',include:true,transport:[loop,unknown,loop2]};
  const closure=journeyClosure([j]);assert.equal(closure.balanced,true);assert.equal(closure.connected,true);assert.equal(closure.closed,false);
  const row=trajectoryRows([loop,unknown,loop2],[j]).find(r=>r['交通编号']==='UNKNOWN');
  assert.equal(row['发生状态'],'待还原');assert.equal(row['接续状态'],'待核');assert.equal(row['里程公里'],'');
});

test('重叠的不确定时间窗口不制造开始日与结束日的假逆序',()=>{
  const a={...transport,id:'a',date:'2020-01-01 — 2020-01-31',names:['A','B'],points:[[0,0],[0,1]],startDate:'2020-01-01',endDate:'2020-01-31',timePrecision:'区间',sequence:1};
  const b={...transport,id:'b',date:'2020-01-02 — 2020-01-03',names:['B','C'],points:[[0,1],[0,2]],startDate:'2020-01-02',endDate:'2020-01-03',timePrecision:'区间',sequence:2};
  const rows=trajectoryRows([a,b],[{id:'J',transport:[a,b]}]);
  assert.equal(rows[1]['接续状态'],'连续');assert.equal(rows[1]['排序问题'],'');
});

test('结构未知LINK只是精确段接续覆盖，不参与普通路线日期排序',()=>{
  const a={...transport,id:'a',date:'2020-01-01',names:['A','B'],points:[[0,0],[0,1]],sequence:1};
  const b={...transport,id:'b',date:'2020-01-02',names:['C','D'],points:[[0,2],[0,3]],sequence:2};
  const link={...transport,id:'LINK',date:'2019',startDate:'2019',endDate:'2021',timePrecision:'年',
    names:['B','C'],points:[[0,1],[0,2]],recordType:'接驳段',previousTransport:'a',nextTransport:'b',previousSegment:1,nextSegment:1,
    countDistance:false,structuralLink:true,mode:'交通方式待定',km:null};
  const j={id:'J',transport:[a,link,b]};
  const rows=trajectoryRows([a,link,b],[j]);
  assert.deepEqual(rows.map(r=>r['交通编号']),['a','LINK','b']);
  assert.equal(rows[1]['路线段'],'接驳');assert.doesNotMatch(rows[2]['排序问题'],/时间逆序|日期次序冲突/);
  assert.equal(rows[1]['接续状态'],'待核');assert.equal(rows[2]['接续状态'],'待还原');
});
