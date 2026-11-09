import test from 'node:test';
import assert from 'node:assert/strict';
import {createScopeEngine} from '../src/scope-model.mjs';
import {mapMarkup,passportSvg,passportLines} from '../src/site-map.mjs';
import {simplifyRing} from '../scripts/display-geometry.mjs';
import {placeLabels} from '../src/map-labels.mjs';
import {mapFrames,frameProject,frameFor} from '../src/map-frames.mjs';
import {travelTime,durationSummary} from '../src/transport-time.mjs';
import {cityMapFrame} from '../src/city-map.mjs';

function fixture(){const a={id:'A',name:'甲城',country:'甲国',unitId:'A-1',lat:30,lon:110,active:true,visited:true},b={id:'B',name:'乙城',country:'甲国',unitId:'A-2',lat:31,lon:111,active:true,visited:true},c={id:'C',name:'海外枢纽',country:'乙国',unitId:'',lat:40,lon:120,active:false,visited:false};
  return {meta:{totalKm:1100,flightMinutes:120,nodes:3},geometries:{},dots:[],places:[a,b,c],
    scopes:[{id:'world',level:'world',countries:['甲国','乙国'],units:[{id:'甲国',name:'甲国'},{id:'乙国',name:'乙国'}],coverage:['甲国'],name:'全球',english:'WORLD',bounds:[-180,-58,180,84]},
      {id:'a',level:'country',parent:'world',countries:['甲国'],units:[{id:'A-1',name:'甲省'},{id:'A-2',name:'乙省'}],name:'甲国',english:'A',bounds:[105,25,115,35]},
      {id:'unit:A-1',level:'unit',parent:'a',countries:['甲国'],unitId:'A-1',units:[],name:'甲省',english:'A1',bounds:[105,25,115,35]}],
    routes:[{id:'R1',km:100,minutes:0,mode:'铁路',date:'2020',nodes:[a,b]},
      {id:'R2',km:1000,minutes:120,mode:'飞机',date:'2021',nodes:[b,c]}]};}

test('全球→国家→行政区只改变投影，跨界路线可见但不虚拆公里，转机不激活到访',()=>{
  const d=fixture(),e=createScopeEngine(d),global=e.query('world'),country=e.query('a'),unit=e.query('unit:A-1');
  assert.equal(global.stats.km,1100);assert.equal(global.stats.visited,1);assert.equal(global.stats.places,2);
  assert.equal(country.stats.km,100);assert.equal(country.border.length,1);assert.equal(country.routes.length,2);
  assert.equal(unit.stats.km,0);assert.equal(unit.border.length,1);assert.equal(unit.stats.places,1);
  assert.equal(unit.scope.parent,'a');assert.equal(d.routes[1].km,1000);
});

test('海外线路保留真实端点和入出方向，不折叠转机；无姓名 SVG 使用当前分区数据',()=>{
  const d=fixture(),e=createScopeEngine(d),v=e.query('a'),svg=passportSvg(d,e,v);
  assert.match(svg,/海外枢纽/);assert.match(svg,/乙城 → 海外枢纽/);assert.match(svg,/100/);
  assert.equal(passportLines(v).length,2);assert.ok(passportLines(v).every(l=>l.length===44));
  assert.throws(()=>e.query('unknown'),/未知分区/);
});

test('不同数据集的地图缓存隔离，空行政区不伪造到访着色',()=>{
  const d=fixture(),e=createScopeEngine(d),first=mapMarkup(d,e,e.query('a'));
  const other=fixture();other.routes=[];other.places=[];const oe=createScopeEngine(other);
  const second=mapMarkup(other,oe,oe.query('a'));assert.notEqual(first,second);assert.doesNotMatch(second,/海外枢纽/);
});

test('显示几何简化保留闭合边界和微小环，原始事实坐标不修改',()=>{
  const ring=[[0,0],[.1,0],[.2,0],[1,0],[1,1],[0,1],[0,0]],copy=structuredClone(ring),out=simplifyRing(ring);
  assert.ok(out.length<ring.length);assert.deepEqual(out[0],out.at(-1));assert.deepEqual(ring,copy);
  const small=[[0,0],[.0001,0],[.0001,.0001],[0,0]];assert.equal(simplifyRing(small).length,4);
});

test('区域树拒绝遗漏上级、重复身份与循环，国家下钻保留祖先链',()=>{
  const d=fixture();d.scopes.push({id:'macro',name:'大区',level:'macro',parent:'world',countries:['甲国'],units:[],bounds:[105,25,115,35]});d.scopes[1].parent='macro';
  const e=createScopeEngine(d);assert.deepEqual(e.query('macro').children.map(s=>s.id),['a']);assert.equal(e.scopes.get(e.scopes.get('a').parent).parent,'world');
  const missing=structuredClone(d);missing.scopes[1].parent='missing';assert.throws(()=>createScopeEngine(missing),/上级不存在/);
  const cycle=structuredClone(d);cycle.scopes.at(-1).parent='unit:A-1';assert.throws(()=>createScopeEngine(cycle),/循环/);
  const duplicate=structuredClone(d);duplicate.scopes.push(duplicate.scopes[0]);assert.throws(()=>createScopeEngine(duplicate),/重复/);
});

test('未到访国家和行政区不进入导航，交通端点不激活，完整覆盖分母保持',()=>{
  const d=fixture();d.scopes.push({id:'empty',parent:'world',level:'country',countries:['乙国'],units:[],bounds:[110,30,125,45]});
  d.scopes.push({id:'unit:A-3',parent:'a',level:'unit',unitId:'A-3',countries:['甲国'],units:[],bounds:[105,25,115,35]});d.scopes[1].units.push({id:'A-3',name:'未到访省'});
  const e=createScopeEngine(d);assert.equal(e.isVisible('empty'),false);assert.equal(e.isVisible('unit:A-3'),false);assert.equal(e.query('a').stats.total,3);
  assert.deepEqual(e.visibleChildren('a').map(s=>s.id),['unit:A-1']);assert.equal(e.isVisible('world'),true);
  d.scopes[0].coverage.push('乙国');assert.equal(createScopeEngine(d).isVisible('empty'),true);
});

test('重复行政入口和旧链接直接解析城市，保留事实分区与完整祖先关系',()=>{
  const d=fixture();d.scopes[2].detailScopeId='city:sample';
  d.scopes.push({id:'city:sample',name:'甲城',english:'CITY',parent:'a',level:'city',cityId:'sample',countries:['甲国'],units:[],bounds:[105,25,115,35]});
  const a={...d.places[0],cityId:'sample'};d.cities={sample:{places:[a],routes:[],trips:[],tracks:[]}};
  const e=createScopeEngine(d);assert.equal(e.resolve('unit:A-1'),'city:sample');
  assert.strictEqual(e.query('unit:A-1'),e.query('city:sample'));
  assert.deepEqual(e.visibleChildren('a').map(s=>s.id),['city:sample']);
  assert.equal(e.query('world').stats.places,2);assert.equal(e.scopes.get('city:sample').parent,'a');
  d.scopes[2].detailScopeId='missing';assert.throws(()=>createScopeEngine(d),/默认详情/);
});

test('稀疏地图全部标注，不依赖地区配置；密集地图有限额并优先高频点',()=>{
  const d=fixture(),e=createScopeEngine(d),view=e.query('a');const frames=mapFrames(view.scope).map(f=>({...f,project:frameProject(f)}));
  const labels=placeLabels(view,frames,frameFor);assert.equal(labels.length,2);assert.deepEqual(new Set(labels.map(l=>l.name)),new Set(['甲城','乙城']));
  const dense={...view,places:Array.from({length:40},(_,i)=>({id:'P'+i,name:'地点'+i,lat:26+Math.floor(i/8),lon:106+i%8})),routes:[]};
  dense.routes=Array.from({length:20},()=>({nodes:[dense.places[39]]}));const limited=placeLabels(dense,frames,frameFor);
  assert.ok(limited.length<=12);assert.equal(limited[0].id,'P39');
});

test('移动时长优先已有依据，缺失按方式估算，含地面不含跨区整段航班',()=>{
  assert.equal(travelTime({mode:'公路',km:120,travelMinutes:150,travelDurationBasis:'行车记录'}).minutes,150);
  assert.equal(travelTime({mode:'公路',km:120}).minutes,120);assert.equal(travelTime({mode:'铁路',km:100}).minutes,60);
  assert.equal(travelTime({mode:'飞机',km:1000,minutes:120}).minutes,120);
  assert.equal(travelTime({mode:'轮渡',km:null}).minutes,null);
  const d=fixture(),e=createScopeEngine(d);assert.equal(e.query('a').stats.travelMinutes,60);assert.equal(e.query('a').stats.flightHours,0);
  assert.equal(e.query('world').stats.travelMinutes,180);assert.equal(e.query('world').stats.flightHours,2);
  assert.equal(durationSummary([{mode:'公路',km:1},{mode:'公路',km:1}]).minutes,4);
});

test('全球飞行与动态方式累计使用同一维护分钟，不因缺时长航段多算',()=>{
  const d=fixture(),plane=d.routes.find(r=>r.mode==='飞机');
  d.routes.push({...plane,id:'FLIGHT-MISSING',km:675,minutes:null,durationType:'unknown'});
  const world=createScopeEngine(d).query('world');
  assert.equal(world.duration.modes.find(m=>m.mode==='飞机').minutes,d.meta.flightMinutes);
  assert.equal(world.stats.flightHours,2);assert.equal(world.duration.missing,1);
  assert.equal(world.stats.travelMinutes,180);
});

test('区域接续和待还原关系属于连接数量，不增加已恢复移动次数',()=>{
  const d=fixture(),nodes=d.routes[0].nodes;
  d.routes.push({id:'REGION-LINK',mode:'区域接续',recordType:'区域接续',countDistance:false,countDuration:false,nodes},
    {id:'UNKNOWN-LINK',mode:'交通方式待定',occurrenceStatus:'待还原',countDistance:false,countDuration:false,nodes});
  const country=createScopeEngine(d).query('a');
  assert.equal(country.stats.routes,2);assert.equal(country.stats.pendingConnections,2);
  assert.equal(country.stats.km,100);assert.equal(country.stats.travelMinutes,60);
});

test('城市细地点和移动独立投影，按日期筛选，不重复增加全球计数；机场不激活城市行政区',()=>{
  const d=fixture();d.scopes.push({id:'city:sample',name:'甲城',english:'CITY',parent:'unit:A-1',level:'city',cityId:'sample',countries:['甲国'],bounds:[105,25,115,35],units:[{id:'W1',name:'西区'},{id:'W2',name:'机场区'}]},
    {id:'district:W1',name:'西区',english:'WEST',parent:'city:sample',level:'district',cityId:'sample',districtId:'W1',countries:['甲国'],units:[],bounds:[105,25,115,35]},
    {id:'district:W2',name:'机场区',parent:'city:sample',level:'district',cityId:'sample',districtId:'W2',countries:['甲国'],units:[],bounds:[105,25,115,35]});
  const a={...d.places[0],id:'LOCAL-A',cityId:'sample',districtId:'W1'},b={...a,id:'LOCAL-B',name:'乙景区'},airport={...a,id:'AIRPORT',districtId:'W2',active:false,visited:false};
  d.cities={sample:{places:[a,b,airport],trips:[{id:'T1',first:'2020-01-01',last:'2020-01-02'}],tracks:[{date:'2020-01-01',points:[]},{date:'2021-01-03',points:[]}],photoPoints:[{date:'2021-01-03',lat:30,lon:110}],routes:[{id:'C1',tripId:'T1',date:'2020-01-01',mode:'步行',km:1,travelMinutes:15,nodes:[a,b]},{id:'C2',tripId:'T1',date:'2020-01-02',mode:'市内交通',km:3,travelMinutes:20,nodes:[b,airport]}]}};
  const e=createScopeEngine(d),city=e.query('city:sample'),day=e.query('city:sample',{tripId:'T1',date:'2020-01-01'});
  assert.equal(e.query('world').stats.km,1100);assert.equal(e.query('world').stats.places,2);
  assert.equal(city.stats.places,2);assert.equal(city.stats.km,4);assert.equal(city.stats.visited,1);assert.equal(city.stats.total,2);assert.equal(city.stats.travelMinutes,35);
  assert.equal(day.routes.length,1);assert.equal(day.stats.km,1);assert.equal(day.tracks.length,1);assert.equal(e.isVisible('district:W2'),false);
  assert.equal(city.tracks.length,2);assert.equal(city.photoPoints.length,1);assert.equal(city.stats.lastYear,2021);
  const unwritten=e.query('city:sample',{date:'2021-01-03'});assert.equal(unwritten.tracks.length,1);assert.equal(unwritten.photoPoints.length,1);assert.equal(unwritten.stats.km,0);assert.equal(unwritten.stats.places,0);
  assert.equal(e.query('city:sample',{tripId:'T1'}).tracks.length,1);assert.equal(e.query('city:sample',{tripId:'T1'}).photoPoints.length,0);
  assert.equal(e.query('district:W1').stats.km,1);assert.equal(e.query('district:W1').border.length,1);
  assert.strictEqual(e.query('city:sample',{tripId:'T1',date:'2020-01-01'}),day);
});

test('城市作为导航终点，行政区只保留查询能力，省级详情仍能进入城市',()=>{
  const d=fixture(),city={id:'city:sample',name:'甲城',english:'CITY',parent:'a',level:'city',cityId:'sample',countries:['甲国'],units:[{id:'D1',name:'区'}],bounds:[105,25,115,35]};
  d.scopes.push(city,{id:'district:D1',name:'区',parent:city.id,level:'district',cityId:'sample',districtId:'D1',countries:['甲国'],units:[],bounds:city.bounds});
  const p={...d.places[0],cityId:'sample',districtId:'D1'};d.cities={sample:{places:[p],routes:[],trips:[],tracks:[]}};
  const e=createScopeEngine(d);assert.equal(e.navigationLeaf(city.id),true);assert.deepEqual(e.visibleChildren(city.id),[]);assert.equal(e.isVisible('district:D1'),false);assert.equal(e.query('district:D1').stats.places,1);
  city.detailKind='province';const province=createScopeEngine(d);assert.equal(province.navigationLeaf(city.id),false);assert.equal(province.isVisible('district:D1'),true);
});

test('城市和23个行政区均按自身完整边界适配画布，小行政区不会继承城际扩边',()=>{
  const geo={features:Array.from({length:23},(_,i)=>{
    const col=i%5,row=Math.floor(i/5),west=10+col*.4,south=20+row*.35,east=west+.3,north=south+.25;
    return {type:'Feature',id:'TEST-'+String(i+1).padStart(2,'0'),geometry:{type:'Polygon',coordinates:[[[west,south],[east,south],[east,north],[west,north],[west,south]]]}};
  })};
  for(const districtId of [undefined,...geo.features.map(f=>f.id)]){
    const frame=cityMapFrame({districtId,focusBounds:[9,19,13,22]},geo);
    const points=frame.features.flatMap(f=>f.geometry.type==='Polygon'?f.geometry.coordinates.flat():f.geometry.coordinates.flat(2));
    const projected=points.map(([lon,lat])=>frame.project([lat,lon]));
    const xs=projected.map(p=>p[0]),ys=projected.map(p=>p[1]),[x,y,w,h]=frame.extent;
    assert.ok(Math.min(...xs)>=x-1e-6&&Math.max(...xs)<=x+w+1e-6,'完整东西边界可见：'+districtId);
    assert.ok(Math.min(...ys)>=y-1e-6&&Math.max(...ys)<=y+h+1e-6,'完整南北边界可见：'+districtId);
    const occupancy=Math.max((Math.max(...xs)-Math.min(...xs))/w,(Math.max(...ys)-Math.min(...ys))/h);
    assert.ok(occupancy>.99,'地图至少一个方向铺满安全区：'+districtId);
  }
});

test('城市地图有显式游览窗口时不被窗口外定位与照片拉远',()=>{
  const geo={features:[{geometry:{type:'Polygon',coordinates:[[[110,20],[112,20],[112,22],[110,22],[110,20]]]}}]};
  const scope={mapBounds:[110.5,20.5,111,21]},view={evidence:{retainedTracks:2},tracks:[{points:[[110.2,20.2],[111.8,21.8]]}],photoPoints:[{lon:111.9,lat:21.9}]};
  const frame=cityMapFrame(scope,geo,view);
  assert.deepEqual(frame.bounds,scope.mapBounds);
  for(const [lon,lat]of [[110.5,20.5],[111,21]]){const [x,y]=frame.project([lat,lon]);assert.ok(x>=155&&x<=845&&y>=55&&y<=555);}
});
