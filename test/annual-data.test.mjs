import test from 'node:test';
import assert from 'node:assert/strict';
import {annualView} from '../scripts/annual-data.mjs';
import {annualMap} from '../scripts/annual-map.mjs';

const place=(id,name,country,first,extra={})=>({id,name,country,first,lat:10,lon:20,status:'已到访',include:true,level:'城市/城镇',source:'trip.md',...extra});
const route=(id,date,km,extra={})=>({id,date,startDate:date,endDate:date,km,mode:'飞机',minutes:60,points:[[10,20],[30,40]],names:['基地','目的地'],include:true,...extra});
const visit=(id,placeId,startDate,extra={})=>({id,placeId,startDate,endDate:startDate,activity:'地面到访',include:true,journeyId:'J',...extra});
function fixture(){return {meta:{earthKm:40075},routes:[],locationLayer:{places:[place('HOME','基地','中国','2020-01-01')]},visitInstances:[],journeyLayer:{journeys:[{id:'J',source:'trip.md'}]}};}
const project=a=>annualView(a,{year:2026,asOf:'2026-11-05',basePlaceId:'HOME'});

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
