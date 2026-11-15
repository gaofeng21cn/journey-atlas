import test from 'node:test';
import assert from 'node:assert/strict';
import {atlasConnections,mergeDetailConnections} from '../scripts/detail-connections.mjs';
const config={id:'city',country:'甲国',unitId:'A'};
const geo={features:[{id:'city-1',geometry:{type:'Polygon',coordinates:[[[10,10],[11,10],[11,11],[10,11],[10,10]]]}}]};
const airport={id:'AIR',name:'机场',lat:10.2,lon:10.8,country:'甲国',cityId:'city',districtId:'city-1',active:false,visited:false,level:'交通接续'};
const atlas={locationLayer:{places:[]},routes:[{id:'F1',names:['实际转机城','甲城机场'],displayNames:['实际转机城','甲城'],points:[[40,120],[10.2,10.8]],displayPoints:[[40,120],[10.5,10.5]],countries:['乙国','甲国'],
  nodeRefs:[{id:'FOREIGN',country:'乙国',displayName:'实际转机城',point:[40,120]},{id:'RAW',country:'甲国',point:[10.2,10.8]}],km:2000,date:'2010-01-01',mode:'飞机',minutes:200}]};
test('城市页继承真实跨境转机边，接到实际机场而非市中心，不激活到访',()=>{
  const routes=atlasConnections(config,geo,atlas,[airport]);
  assert.equal(routes.length,1);assert.strictEqual(routes[0].nodes[1],airport);
  assert.equal(routes[0].nodes[0].name,'实际转机城');assert.equal(routes[0].date,'2010-01-01');
  assert.equal(routes[0].nodes[1].visited,false);assert.equal(routes[0].km,2000);
});
test('同日同向城市维护航段优先，反方向或其他年份接续保留',()=>{
  const [route]=atlasConnections(config,geo,atlas,[airport]);
  const old={...route,id:'CITY-F1'};
  assert.equal(mergeDetailConnections([old],[route]).length,1);
  assert.equal(mergeDetailConnections([old],[{...route,date:'2016-01-01'}]).length,2);
  assert.equal(mergeDetailConnections([old],[{...route,nodes:[...route.nodes].reverse()}]).length,2);
});

test('跨城轨迹中途的定位片段归入已登记铁路时，城市边缘显示铁路真实终点',()=>{
  const rail={id:'RAIL',names:['甲城','乙城'],points:[[10.5,10.5],[12,12]],countries:['甲国'],km:200,date:'2024-01-01',mode:'铁路'};
  const record={locationLayer:{places:[]},routes:[rail],mobility:{ownership:[{referenceId:'RAIL',moveIds:['PART']}],reconstruction:{
    nodes:[{id:'A',lat:10.5,lon:10.5},{id:'MID',lat:11.2,lon:11.2}],moves:[{id:'PART',fromNodeId:'A',toNodeId:'MID'}]}}};
  const routes=atlasConnections(config,geo,record,[]);
  assert.deepEqual(routes.map(r=>r.id),['RAIL']);
  assert.equal(routes[0].nodes[1].name,'乙城');
});
