import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readRegionPlaces,regionView } from '../scripts/region-data.mjs';
import { mergeRows } from '../scripts/update-atlas.mjs';
import { pointInFeature,renderRegionMap } from '../scripts/region-map.mjs';
import { borderRouteEndpoints,renderEdgeLabels } from '../scripts/edge-labels.mjs';
import { routeSegments,arcPath } from '../scripts/route-geometry.mjs';
import { journeyLayer,locationLayer,journeySummaryRows } from '../scripts/travel-layers.mjs';
const catalog=JSON.parse(await readFile(new URL('../data/region-catalog.json',import.meta.url)));
const p=(id,name,status,code='US-NY',country='美国',countryCode='US')=>({'地点编号':id,'城市/地点':name,'国家地区':country,'国家代码':countryCode,'一级区域代码':code,'到访状态':status,'分享纳入':'纳入','核定依据':'本人确认地面旅行','关联正文':'旅行.md','最早线索日':'2017-01-01','最晚线索日':'2017-01-01'});

test('机场及GPS候选不激活，美国DC单列，两座同州城市仍只算一州',()=>{
  const places=readRegionPlaces([p('1','City Alpha','已到访'),p('2','City Beta','已到访'),p('3','District City','已到访','US-DC'),p('4','Transit City','途经/机场','US-MI'),p('5','Candidate City','待核','US-IA')],catalog);
  const v=regionView(catalog.usa,places,[]);
  assert.equal(v.meta.visited,1);assert.deepEqual(v.meta.special,['华盛顿特区']);assert.equal(v.meta.cities,3);
  assert.equal(v.units.find(u=>u.id==='US-MI').active,false);
  assert.throws(()=>readRegionPlaces([p('x','Conflicting City','已到访','US-NY','意大利','IT')],catalog),/所属国家/);
});
test('欧洲统一分享计划而不改变事实；跨境里程只纳入完整地区',()=>{
  const places=readRegionPlaces([p('1','Planned City','计划','','西班牙','ES'),p('2','Transit City','途经/机场','','芬兰','FI'),p('3','Visited City','已到访','CH-BE','瑞士','CH')],catalog);
  const routes=[{countries:['瑞士'],km:100},{countries:['瑞士','法国'],km:80},{countries:['中国','瑞士'],km:9000},{countries:['瑞士'],km:null}];
  const eu=regionView(catalog.europe,places,routes),ch=regionView(catalog.switzerland,places,routes);
  assert.equal(eu.meta.visited,2);assert.equal(places[0].status,'计划');assert.equal(eu.meta.km,180);
  assert.equal(ch.meta.km,100);assert.equal(ch.meta.missingKm,1);assert.equal(ch.meta.routes,2);
});
test('希腊按13个行政大区统计，伯罗奔尼撒节点不退化为国家级覆盖',()=>{
  const places=readRegionPlaces([
    p('g1','Region A City','已到访','GR-A1','希腊','GR'),
    p('g2','Region B City','已到访','GR-J','希腊','GR'),
    p('g3','Region C City','已到访','GR-E','希腊','GR'),
    p('g4','Region D City','已到访','GR-L','希腊','GR')
  ],catalog);
  const v=regionView(catalog.greece,places,[]);
  assert.equal(catalog.greece.denominator,13);
  assert.equal(catalog.greece.units.length,13);
  assert.equal(v.meta.visited,4);
  assert.deepEqual(v.units.filter(u=>u.active).map(u=>u.id).sort(),['GR-A1','GR-E','GR-J','GR-L']);
});
test('按编号局部更新保留人工依据、未知字段拒绝，同一补丁重复编号拒绝',()=>{
  const rows=[p('a','City Alpha','待核')];
  const result=mergeRows(rows,[{'地点编号':'a','到访状态':'已到访'}],'地点编号');
  assert.equal(result.rows.length,1);assert.equal(result.rows[0]['核定依据'],rows[0]['核定依据']);
  assert.equal(result.rows[0]['关联正文'],rows[0]['关联正文']);assert.equal(rows[0]['到访状态'],'待核');
  assert.deepEqual(result.changes,{added:0,updated:1,unchanged:0});
  assert.equal(mergeRows(result.rows,[{'地点编号':'a','到访状态':'已到访'}],'地点编号').changes.unchanged,1);
  assert.throws(()=>mergeRows(rows,[{'地点编号':'a','新字段':'bad'}],'地点编号'),/未登记字段/);
  assert.throws(()=>mergeRows(rows,[{'地点编号':'a'},{'地点编号':'a'}],'地点编号'),/重复/);
});
test('地图坐标按经纬顺序，洞不着色，小国零采样时仍有激活点',()=>{
  const poly={type:'Feature',id:'tiny',geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]],[[.4,.4],[.6,.4],[.6,.6],[.4,.6],[.4,.4]]]}};
  assert.equal(pointInFeature([.2,.2],poly),true);assert.equal(pointInFeature([.5,.5],poly),false);
  const config={name:'示例',units:[{id:'tiny',name:'小国',anchor:[.2,.2]}],bounds:[-1,-1,2,2],step:5,labels:[],source:'示例'};
  const map=renderRegionMap(config,{features:[poly]},{units:[{id:'tiny',active:true}],routes:[],places:[]});
  assert.equal(map.active,1);assert.match(map.svg,/jp-dot visited/);
});
test('跨区页边按端点国家识别，不受海外城市仍落在地图框内影响',()=>{
  const route={mode:'飞机',names:['Overseas City','Local City'],displayNames:['Overseas City','Local City'],points:[[22.3,114.2],[1.35,103.8]],displayPoints:[[22.3,114.2],[1.35,103.8]],countries:['Example Overseas','Example Local'],nodeRefs:[{country:'Example Overseas'},{country:'Example Local'}]};
  const edge=borderRouteEndpoints(route,['Example Local']);
  assert.equal(edge.awayName,'Overseas City');assert.equal(edge.homeName,'Local City');
  const map=renderEdgeLabels({routes:[route],regionCountries:['Example Local'],bounds:[92,-11,142,29],project:([lat,lon])=>[lon,lat],extent:[12,0,976,100],gap:30});
  assert.equal(map.groups,1);assert.equal(map.paths,1);assert.match(map.svg,/data-edge="true"/);assert.match(map.svg,/data-edge-label="true"/);
});
test('页边按海外纬度排序，超界北方城市和密集南方城市均保持间距与安全边界',()=>{
  const route=(name,lat,lon,homeLat)=>({mode:'飞机',names:['区域城市',name],
    points:[[homeLat,110],[lat,lon]],countries:['区域','海外']});
  const routes=[route('南部甲',31,140,45),route('最北甲',70,140,20),
    route('北部乙',60,140,25),route('南部乙',30,140,44),
    route('西侧南部',-10,0,45),route('西侧北部',50,0,20)];
  const map=renderEdgeLabels({routes,regionCountries:['区域'],bounds:[73,17,136,54],
    project:([lat,lon])=>[lon,(54-lat)*12],extent:[12,38,976,610],gap:30,verticalPadding:72});
  const labels=[...map.svg.matchAll(/<text class="jp-label jp-edge-label"[^>]* y="([^"]+)" text-anchor="([^"]+)">([^<]+)<\/text>/g)]
    .map(m=>({y:Number(m[1])-5,anchor:m[2],name:m[3]}));
  for(const anchor of ['start','end']){
    const side=labels.filter(p=>p.anchor===anchor).sort((a,b)=>a.y-b.y);
    assert.deepEqual(side.map(p=>p.name),anchor==='start'?['最北甲','北部乙','南部甲','南部乙']:['西侧北部','西侧南部']);
    assert.ok(side.every(p=>p.y>=110&&p.y<=636));
    for(let i=1;i<side.length;i++)assert.ok(side[i].y-side[i-1].y>=29.9);
  }
});
test('往返画两程弧线，同向重复只合并笔画，不合并行程或公里',()=>{
  const r={id:'1',date:'2020',mode:'铁路',names:['示例甲城','示例乙城','示例甲城'],points:[[32,130],[33,129],[32,130]],km:200,
    journeyId:'EXAMPLE-J',journeyName:'虚构往返',base:'示例甲城',source:'旅行.md',status:'合理推定',evidence:'本人确认',include:true};
  const legs=routeSegments([r,{...r,id:'2'}]);
  assert.equal(legs.length,2);assert.equal(legs[0].count,2);
  assert.notEqual(arcPath([0,0],[100,0],'铁路'),arcPath([100,0],[0,0],'铁路'));
  assert.match(arcPath([0,0],[100,0],'铁路'),/Q50,16/);
  assert.match(arcPath([100,0],[0,0],'铁路'),/Q50,-16/);
  const layer=journeyLayer([{行程编号:'EXAMPLE-J',行程名称:'虚构往返',出发基地:'示例甲城',关联交通编号:'1；2',行程依据:'本人确认',关联正文:'旅行.md',分享纳入:'纳入',重构状态:'本人确认'}],[r,{...r,id:'2'}],locationLayer([],[]));
  const journeys=journeySummaryRows(layer);
  assert.equal(journeys.length,1);assert.equal(journeys[0]['已计里程公里'],400);assert.equal(journeys[0]['交通编号'],'1；2');
  assert.equal(journeys[0]['出发基地'],'示例甲城');
});
