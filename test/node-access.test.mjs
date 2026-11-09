import test from 'node:test';
import assert from 'node:assert/strict';
import {locationLayer} from '../scripts/travel-layers.mjs';
import {bindRouteNodes,attachAccess,transportNodeId,displayPlaceName,matchingPlaces} from '../scripts/node-access.mjs';
import {routeTime} from '../scripts/travel-layers.mjs';

test('地点接入按显式地点引用统计，机场服务城市不抬高到访状态',()=>{
  const locations=locationLayer([{id:'JP-A',name:'City JP',prefectureId:'13',status:'已到访',lat:10,lon:20}],
    [{id:'US-A',name:'City US',country:'美国',countryCode:'US',status:'已到访',unitId:'US-NY',lat:30,lon:40,include:true}]);
  const records=[{id:'F1',date:'2030-01-01',mode:'飞机',names:['Airport JP','Airport US'],cities:['City JP','City US'],countries:['日本','美国'],points:[[10,20],[30,40]],km:100,include:true,source:'x.md',status:'已使用'}];
  const bound=bindRouteNodes(records,locations);
  assert.equal(bound[0].nodeRefs[0].type,'交通节点');
  assert.equal(bound[0].nodeRefs[0].servicePlaceId,'JP-A');
  assert.equal(bound[0].nodeRefs[1].servicePlaceId,'US-A');
  attachAccess(locations,bound);
  assert.equal(locations.places.find(p=>p.id==='JP-A').access.state,'仅机场/交通节点');
  assert.equal(locations.places.find(p=>p.id==='JP-A').access.pending,true);
});

test('交通路线的显式地点编号与节点编号可静态验证',()=>{
  const locations=locationLayer([{id:'A',name:'甲',prefectureId:'13',status:'已到访',lat:10,lon:20}],[]);
  const records=[{id:'G1',names:['甲','乙'],countries:['日本'],points:[[10,20],[11,21]],nodePlaceIds:['A',''],include:true}];
  const out=bindRouteNodes(records,locations);
  assert.equal(out[0].nodeIds[0],'A');
  assert.match(out[0].nodeIds[1],/^TN-/);
  assert.equal(out[0].nodeIds[1],transportNodeId('乙',[11,21],'日本'));
});

test('机场服务主城仅关联，事实和展示均保留真实机场端点',()=>{
  const locations=locationLayer([], [{id:'SAMPLE-PLACE',name:'City GR',country:'示例国乙',countryCode:'YY',status:'已到访',lat:15.1,lon:15.1,originalNames:['Airport GR'],include:true}]);
  const records=[{id:'F-SAMPLE',date:'2030-05-26',mode:'飞机',names:['Airport QA','Airport GR'],cities:['City QA','City GR'],countries:['示例国甲','示例国乙'],points:[[5,5],[15,15]],km:1,include:true,source:'x.md',status:'已飞'}];
  const bound=bindRouteNodes(records,locations)[0];
  assert.deepEqual(bound.points[1],[15,15]);
  assert.deepEqual(bound.displayPoints[1],[15,15]);
  assert.equal(bound.displayNames[1],'Airport GR');
  assert.equal(bound.nodeRefs[1].servicePlaceId,'SAMPLE-PLACE');
});

test('国外地点显示中文主名并在后方保留原名',()=>{
  assert.equal(displayPlaceName({country:'加拿大',name:'示例城甲',original:'Sample Place'}),'示例城甲（Sample Place）');
  assert.equal(displayPlaceName({country:'希腊',name:'示例城乙',original:'示例原名（ZZ）；Sample Name'}),'示例城乙（Sample Name）');
  assert.equal(displayPlaceName({country:'瑞士',name:'示例城丙',original:'示例旧名'}),'示例城丙');
  assert.equal(displayPlaceName({country:'中国',name:'城市甲',original:'城市甲'}),'城市甲');
});

test('时间键保留区间精度并拒绝逆序日期',()=>{
  assert.deepEqual(routeTime({'日期或区间':'2001-12—2002'}),{startDate:'2001-12',endDate:'2002',timePrecision:'区间',sequence:null});
  assert.throws(()=>routeTime({'开始日期':'2025-02-30','结束日期':'2025-03'}),/日期无效/);
  assert.throws(()=>routeTime({'开始日期':'2025-04-01','结束日期':'2025-03-01'}),/结束日期早于/);
});

test('确认过城市地面到访的航班绑定不能吞掉行程内机场接驳',()=>{
  const locations=locationLayer([], [{id:'SVC',name:'Sample City',country:'Sampleland',countryCode:'XX',status:'已到访',lat:10,lon:10,originalNames:['Sample Airport'],include:true,transportAccess:'确认',transportAccessFrom:'2031-06-01',transportAccessTo:'2031-06-05'}]);
  const base={date:'2031-06-01',include:true,countries:['Sampleland']};
  const records=[{...base,id:'F',mode:'飞机',names:['Remote Airport','Sample Airport'],cities:['Remote City','Sample City'],points:[[20,20],[10.2,10.2]]},
    {...base,id:'G',mode:'地面交通待定',names:['Sample Airport','Sample City'],points:[[10.2,10.2],[10,10]]}];
  const bound=bindRouteNodes(records,locations);
  assert.equal(bound[0].nodeRefs[1].placeId,'');
  assert.equal(bound[0].nodeRefs[1].associatedPlaceId,'SVC');
  assert.match(bound[0].nodeIds[1],/^TN-/);
  assert.equal(bound[1].nodeRefs[0].type,'交通节点');
  assert.notEqual(bound[1].nodeIds[0],bound[1].nodeIds[1]);
  assert.equal(bound[1].nodeRefs[1].placeId,'SVC');
});

test('飞机源行误引用服务城市编号时仍保留实际机场身份',()=>{
  const locations=locationLayer([], [{id:'CITY',name:'City JP',country:'日本',countryCode:'JP',status:'已到访',lat:10,lon:20,include:true}]);
  const airport=[10.2,10.2],r={id:'F',mode:'飞机',names:['Airport Alpha','Airport Beta'],cities:['City JP','City Beta'],countries:['日本'],points:[airport,[20.2,20.2]],nodeIds:['CITY','TN-beta']};
  const out=bindRouteNodes([r],locations)[0];
  assert.notEqual(out.nodeIds[0],'CITY');
  assert.equal(out.nodeRefs[0].associatedPlaceId,'CITY');
  assert.deepEqual(out.displayPoints[0],airport);
  assert.equal(out.nodeIds[1],'TN-beta');
});

test('同国近邻及共有地名前缀不能自动建立节点关联',()=>{
  const p={id:'A',name:'示例甲镇',country:'中国',lat:10,lon:10};
  assert.deepEqual(matchingPlaces('示例甲镇机场',[10,10],['中国'],[p]),[p]);
  assert.deepEqual(matchingPlaces('示例甲镇某景区',[10,10],['中国'],[p],{ground:true}),[]);
  const locations=locationLayer([], [{...p,countryCode:'CN',status:'已到访',include:true}]);
  const out=bindRouteNodes([{id:'G',mode:'公路',names:['示例甲镇','Elsewhere'],countries:['中国'],points:[[10.2,10],[11,11]]}],locations)[0];
  assert.equal(out.nodeRefs[0].placeId,'');
});

test('不同年代的入边与出边不能组成一次完整到访',()=>{
  const p={id:'A',name:'甲',country:'中国',status:'已到访',include:true};
  const layer={places:[p],index:new Map([['A',p]]),summary:{}};
  const routes=[{id:'in-old',date:'2001-01-01',nodeRefs:[{id:'X'},{id:'A',placeId:'A'}]},
    {id:'out-new',date:'2031-01-01',nodeRefs:[{id:'A',placeId:'A'},{id:'Y'}]}];
  attachAccess(layer,routes);
  assert.equal(layer.places[0].access.state,'历史关联待逐次核定');
  assert.equal(layer.places[0].access.pending,true);
  attachAccess(layer,routes,{visitInstances:[{id:'visit-old',placeId:'A',complete:false,pending:true,reason:'缺返程'},
    {id:'visit-new',placeId:'A',complete:false,pending:true,reason:'缺去程'}]});
  assert.equal(layer.places[0].access.state,'到访实例待接续');
  assert.equal(layer.places[0].access.pendingVisits.length,2);
});

test('到访状态按每次实例的进出核定，终生关联保留供追溯',()=>{
  const p={id:'A',name:'甲',country:'中国',status:'已到访',include:true};
  const layer={places:[p],index:new Map([['A',p]]),summary:{}};
  const routes=[{id:'round',date:'2001-01-01',nodeRefs:[{id:'X'},{id:'A',placeId:'A'},{id:'X'}]}];
  attachAccess(layer,routes,{visitInstances:[{id:'visit',placeId:'A',complete:true,pending:false}]});
  assert.equal(layer.places[0].access.state,'完整接续');
  assert.equal(layer.places[0].access.pending,false);
  assert.deepEqual(layer.places[0].access.incoming,['round']);
});

test('已排除的重复地理标签不抢占核定地面节点的唯一匹配',()=>{
  const locations=locationLayer([], [{id:'ACTIVE',name:'Town Alpha',country:'示例国乙',countryCode:'US',status:'已到访',lat:10,lon:10,groundNames:['Venue Alpha'],include:true},
    {id:'DUPLICATE',name:'Town Beta',country:'示例国乙',countryCode:'US',status:'已到访',lat:10,lon:10,originalNames:['Venue Alpha'],include:false}]);
  const bound=bindRouteNodes([{id:'G',mode:'公路',names:['Venue Alpha','Town Gamma'],countries:['示例国乙'],points:[[10,10],[11,11]]}],locations);
  assert.equal(bound[0].nodeRefs[0].placeId,'ACTIVE');
});
