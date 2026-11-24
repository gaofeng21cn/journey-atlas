import test from 'node:test';
import assert from 'node:assert/strict';
import {annualView,resolveAnnualMemory} from '../plugins/travel-passport/scripts/annual-data.mjs';
import {annualMap,resolveAnnualLabels} from '../plugins/travel-passport/scripts/annual-map.mjs';

const place=(id,name,country,first,extra={})=>({id,name,country,first,lat:10,lon:20,status:'已到访',include:true,level:'城市/城镇',source:'trip.md',...extra});
const route=(id,date,km,extra={})=>({id,date,startDate:date,endDate:date,km,mode:'飞机',minutes:60,points:[[10,20],[30,40]],names:['基地','目的地'],include:true,...extra});
const visit=(id,placeId,startDate,extra={})=>({id,placeId,startDate,endDate:startDate,activity:'地面到访',include:true,journeyId:'J',...extra});
function fixture(){return {meta:{earthKm:40075},routes:[],locationLayer:{places:[place('HOME','基地','中国','2020-01-01')]},visitInstances:[],journeyLayer:{journeys:[{id:'J',source:'trip.md'}]}};}
const project=a=>annualView(a,{year:2026,asOf:'2026-11-05',basePlaceId:'HOME'});

test('显式纳入待飞仅扩展同年度有效移动，不激活未来到访或改变实际资料截止日',()=>{
  const a=fixture();a.routes=[route('DONE','2026-01-01',1000),route('PLAN','2026-12-01',2400,{status:'计划'}),route('NEXT','2027-01-01',800,{status:'计划'}),route('DUP','2026-12-01',2400,{status:'计划',metricOwnerIds:['PLAN']})];
  a.locationLayer.places.push(place('FUTURE','未来目的地','示例国','2026-12-01'));
  a.visitInstances=[visit('FUTURE-VISIT','FUTURE','2026-12-01')];
  const v=annualView(a,{year:2026,asOf:'2026-11-05',basePlaceId:'HOME',includePlanned:true});
  assert.equal(v.metrics.flightCount,2);assert.equal(v.metrics.flightKm,3400);assert.deepEqual(v.plannedRouteIds,['PLAN']);
  assert.equal(v.metrics.cities,0);assert.equal(v.dataThrough,'2026-01-01');assert.equal(project(a).metrics.flightCount,1);
});

test('年度公里来自去重后的同一移动账本，包含步行，排除计划和其他年度',()=>{
  const a=fixture();a.routes=[route('F','2026-01-01',1000.125),route('W','2026-01-02',1.234,{mode:'步行'}),route('P','2026-02-01',9000,{status:'计划'}),route('OLD','2025-12-31',2000,{endDate:'2026-01-01'}),route('COVERED','2026-01-01',1000,{metricOwnerIds:['F']})];
  const v=project(a);assert.equal(v.metrics.totalMeters,1001359);assert.equal(v.metrics.flightCount,1);assert.equal(v.metrics.flightHours,1);assert.equal(v.dataThrough,'2026-01-02');
});

test('年度新足迹与历史地面到访比较，机场和转机不激活覆盖',()=>{
  const a=fixture();a.locationLayer.places.push(place('OLD','Historic City','示例国甲','2001-01-01'),place('NEW','New City','示例国乙','2026-03-15'),place('AIR','Transit Airport','示例转机国','2026-01-01',{status:'途经/机场',level:'交通节点'}));
  a.visitInstances=[visit('A','OLD','2026-03-16'),visit('B','NEW','2026-03-15'),visit('C','AIR','2026-01-01',{activity:'交通接触'})];
  const v=project(a);assert.deepEqual(v.newCountries,['示例国乙']);assert.deepEqual(v.newCities.map(p=>p.name),['New City']);assert.equal(v.metrics.countries,2);
});

test('同一已核正文的地面路线恢复当年重访，航空与其他正文不能扩大到访',()=>{
  const a=fixture();a.locationLayer.places.push(place('RETURN','重访城市','日本','2024-01-01'),place('TRANSIT','只经机场的城市','日本','2020-01-01'),place('OTHER','其他正文城市','日本','2020-01-01',{source:'different.md'}));
  a.visitInstances=[visit('OLD','RETURN','2024-01-01')];
  a.routes=[route('GROUND','2026-10-06',20,{mode:'铁路',names:['基地','重访城市','其他正文城市'],source:'trip.md',journeyId:'J'}),route('AIR','2026-10-07',1000,{names:['重访城市','只经机场的城市'],source:'trip.md'})];
  const v=project(a);assert.deepEqual(v.places.map(p=>p.id),['HOME','RETURN']);assert.equal(v.supplementalVisits.length,2);assert.equal(v.newCities.length,0);
});

test('显示归组统一城市计数而不合并里程，地图保留有向往返两条弧线',()=>{
  const a=fixture();a.locationLayer.places.push(place('A','片区甲','荷兰','2026-01-01',{lat:40,lon:50}),place('B','片区乙','荷兰','2026-01-01',{lat:40,lon:50.1}));a.visitInstances=[visit('A1','A','2026-01-01'),visit('B1','B','2026-01-01')];
  a.routes=[route('OUT','2026-01-01',1000),route('BACK','2026-01-02',1000,{points:[[30,40],[10,20]]})];
  const v=annualView(a,{year:2026,basePlaceId:'HOME',placeGroups:[{id:'CITY','name':'同一城市',placeIds:['A','B']}]});assert.equal(v.metrics.cities,1);assert.equal(v.metrics.newCities,1);assert.equal(v.metrics.totalKm,2000);
  const m=annualMap(v,[],{});assert.equal(m.segments,2);assert.equal((m.svg.match(/class="route flight"/g)||[]).length,2);
  assert.throws(()=>annualView(a,{year:2026,basePlaceId:'HOME',placeGroups:[{id:'BAD',name:'错误归组',placeIds:['HOME','A']}]}),/跨国/);
});

test('年度最远地点变化时，地图标注跟随最新计算并保留原地点名称',()=>{
  const view={base:{id:'HOME'},farthest:{id:'CITY',placeIds:['NEW']}};
  const input=[{placeId:'OLD',dx:-3,dy:-34,caption:'年度最远'},{placeId:'HOME',dx:10,dy:10}];
  const labels=resolveAnnualLabels(view,input);
  assert.equal(labels.find(l=>l.placeId==='OLD').caption,undefined);
  assert.equal(labels.find(l=>l.placeId==='NEW').caption,'年度最远');
  assert.equal(input[0].caption,'年度最远');
});

test('旅程强度亮点从同一年度账本汇总航段、里程、时长及基地出发次数',()=>{
  const a=fixture();a.routes=[
    route('OUT','2026-10-01',1200.4,{minutes:120,cities:['基地','甲']}),
    route('BACK','2026-10-02',999.6,{minutes:60,cities:['甲','基地']}),
    route('NEXT','2026-10-03',9000,{cities:['基地','乙']}),
    route('PLAN','2026-10-01',8000,{status:'计划',cities:['基地','乙']})];
  const memory={range:{from:'2026-10-01',to:'2026-10-02',mode:'飞机'},label:'密集出行',
    title:'{count} 段飞行',body:['{km} 公里 · {hours} 小时'],foot:'{departures} 次出发'};
  const resolved=resolveAnnualMemory(project(a),memory);
  assert.deepEqual([resolved.title,...resolved.body,resolved.foot],['2 段飞行','2,200 公里 · 3 小时','1 次出发']);
  assert.deepEqual(resolved.selectedRoutes,['OUT','BACK']);
  assert.deepEqual(resolved.metrics,{count:2,km:2200,hours:3,departures:1});
  assert.deepEqual(resolved.timeline,[{date:'2026-10-01',departure:true},{date:'2026-10-02',departure:false}]);
  assert.equal(memory.title,'{count} 段飞行');
  assert.throws(()=>resolveAnnualMemory(project(a),{...memory,range:{...memory.range,from:'2026-10-04',to:'2026-10-05'}}),/没有计程移动/);
  a.routes[0].minutes=null;
  assert.throws(()=>resolveAnnualMemory(project(a),memory),/缺少移动时长/);
  a.routes[0].cities=[];a.routes[0].km=null;
  const incomplete=resolveAnnualMemory(project(a),{range:memory.range,title:'保留原片段'});
  assert.deepEqual(incomplete.metrics,{count:2,km:null,hours:null,departures:null});
});
