import test from 'node:test';
import assert from 'node:assert/strict';
import { flightView } from '../scripts/flight-view.mjs';
import { flightsFromArchive } from '../scripts/atlas-data.mjs';
import { loadRenderData } from '../scripts/render.mjs';

function atlas(){
  const route={id:'F',include:true,mode:'飞机',status:'已使用',date:'2020-01-01',startDate:'2020-01-01',endDate:'2020-01-01',
    names:['甲机场','转机机场','乙机场'],points:[[0,0],[0,1],[0,2]],nodeIds:['AP-A','AP-T','AP-B'],countries:['中国','转机国','日本'],
    km:1000,minutes:120,airline:'测试航司',countDistance:true,countDuration:true};
  return {routes:[route],countries:[{name:'中国',flag:'🇨🇳'},{name:'日本',flag:'🇯🇵'},{name:'意大利',flag:'🇮🇹'}],meta:{earthKm:40075},
    locationLayer:{places:[
      {id:'A',name:'甲城市',country:'中国',status:'已到访',include:true},
      {id:'B',name:'乙城市',country:'日本',status:'已到访',include:true},
      {id:'P',name:'罗马',country:'意大利',status:'计划',include:true},
      {id:'T',name:'转机城',country:'转机国',status:'途经/机场',include:true},
      {id:'C',name:'待核城市',country:'中国',status:'待核',include:true},
      {id:'X',name:'排除城市',country:'中国',status:'已到访',include:false},
      {id:'ADMIN',name:'行政包装',country:'日本',status:'已到访',level:'行政区',include:true},
    ]}};
}

test('飞行图只读atlas并保留地面与计划覆盖，转机不晋级到访',()=>{
  const source=atlas(),before=structuredClone(source),data=flightView(source);
  assert.deepEqual(source,before);assert.equal(data.meta.source,'atlas');
  assert.equal(data.meta.totalKm,1000);assert.equal(data.meta.totalMinutes,120);
  assert.equal(data.meta.flightCount,2);assert.equal(data.meta.airports,3);assert.equal(data.meta.airlines,1);
  assert.equal(data.meta.cities,3);assert.equal(data.meta.countries,3);
  assert.ok(!data.countries.some(c=>c.name==='转机国'));
  assert.deepEqual(data.airportPoints.find(p=>p.id==='AP-T'),{id:'AP-T',name:'转机机场',lat:0,lon:1,country:'转机国',n:2});
  assert.deepEqual(data.arcs.map(a=>[a.a,a.b]),[[[0,0],[0,1]],[[0,1],[0,2]]]);
});

test('里程和时长计入旗标独立使用，排除及结构候选不进入飞行卡',()=>{
  const source=atlas(),r=source.routes[0];
  source.routes.push({...r,id:'NO-DIST',nodeIds:['AP-A','AP-T','AP-B'],countDistance:false,minutes:30},
    {...r,id:'NO-TIME',countDuration:false,km:100},
    {...r,id:'EXCLUDED',include:false,km:99999},
    {...r,id:'CANDIDATE',candidate:true,km:99999},
    {...r,id:'LINK',structuralLink:true,km:99999});
  const data=flightView(source);
  assert.equal(data.meta.totalKm,1100);assert.equal(data.meta.totalMinutes,150);assert.equal(data.meta.flightCount,6);
  assert.ok(data.flights.filter(f=>f.transportId==='NO-DIST').every(f=>f.km===0));
  assert.ok(data.flights.filter(f=>f.transportId==='NO-TIME').every(f=>f.durationMinutes===0));
  assert.equal(data.meta.airports,3);
});

test('飞行卡只接受当前atlas投影，不再接受旧snapshot路径',()=>{
  const data=flightView(atlas());
  assert.equal(loadRenderData({data}),data);
  assert.throws(()=>loadRenderData({dataPath:'/does-not-exist/legacy-travel.json'}),/不再读取旧travel\.json/);
});

test('航空档案函数生成的route直接构造飞行卡，不经过旧refresh',()=>{
  const source=atlas();
  source.routes=flightsFromArchive([{'证据编号':'ARCHIVE','日期标准':'2024-05-01','统计采用里程公里':'1000',
    '纬度_出发':'0','经度_出发':'0','纬度_到达':'0','经度_到达':'2','出发城市':'甲机场','到达城市':'乙机场',
    '出发国家地区':'中国','到达国家地区':'日本','飞行时长分钟':'120','记录类型':'已使用','统计里程依据':'原档案'}]);
  const data=flightView(source);
  assert.equal(data.meta.flightCount,1);assert.equal(data.meta.totalKm,1000);assert.equal(data.meta.totalMinutes,120);
  assert.deepEqual(data.arcs[0].a,[0,0]);assert.deepEqual(data.arcs[0].b,[0,2]);
  assert.deepEqual(data.countries.map(c=>c.name),['中国','日本','意大利']);
});

test('结构化计划核定不冒充历史航段，但继续计入分享总量',()=>{
  const source=atlas();
  source.routes[0].review={conclusion:'计划'};
  const data=flightView(source);
  assert.equal(data.meta.flightCount,0);assert.equal(data.meta.plannedCount,2);
  assert.equal(data.meta.totalKm,1000);assert.equal(data.meta.totalMinutes,120);
  assert.ok(data.flights.every(f=>f.kind==='planned'));
  source.routes[0].review={conclusion:'已发生'};source.routes[0].status='计划';
  assert.equal(flightView(source).meta.plannedCount,0);
});
