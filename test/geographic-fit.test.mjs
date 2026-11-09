import test from 'node:test';
import assert from 'node:assert/strict';
import {countryDisplay,circularBounds,geometryContains} from '../src/geographic-fit.mjs';
import {frameProject,frameFor} from '../src/map-frames.mjs';
import {fitProjection} from '../src/scope-model.mjs';
import {displayGeometry} from '../scripts/display-geometry.mjs';

const box=(w,s,e,n)=>[[[w,s],[e,s],[e,n],[w,n],[w,s]]];
test('日界线两侧属于一个国家窗口，正负经度不把本土压扁',()=>{
  const points=[[170,40],[-170,40],[-170,60],[170,60]],bounds=circularBounds(points);
  assert.equal(bounds[2]-bounds[0],20);
  const {frames}=countryDisplay({id:'sample',geometry:{type:'Polygon',coordinates:[points.concat([points[0]])]}});
  const project=frameProject(frames[0]);assert.ok(Math.abs(project([50,175])[0]-project([50,-175])[0])<400);
});
test('远方领土单独成图，远方实际节点仍找到自己的投影',()=>{
  const geometry={type:'MultiPolygon',coordinates:[box(0,40,10,50),box(-70,-10,-65,-5)]};
  const {frames}=countryDisplay({id:'sample',geometry},[{lat:-7,lon:-68}]);
  assert.equal(frames.length,2);assert.ok(frames[0].bounds[2]-frames[0].bounds[0]<11);
  assert.strictEqual(frameFor(frames,{lat:-7,lon:-68,unitId:''}),frames[1]);
});
test('微小区域没有最小经纬跨度限制，公共背景标签不能越过行政边界或孔洞',()=>{
  const p=fitProjection([0,0,.001,.001],1000,640,0);assert.ok(p([.001,.001])[0]-p([0,0])[0]>600);
  const g={type:'Polygon',coordinates:[...box(0,0,10,10),...box(3,3,5,5)]};
  assert.equal(geometryContains([2,2],g),true);assert.equal(geometryContains([4,4],g),false);assert.equal(geometryContains([2,12],g),false);
});
test('微小地区的海岸细节按自身尺度简化，不退化成三角形轮廓',()=>{
  const ring=[[0,0],[.002,0],[.002,.001],[.004,.001],[.004,.003],[.002,.003],[.002,.004],[0,.004],[0,0]];
  const geo=displayGeometry({features:[{id:'small',geometry:{type:'Polygon',coordinates:[ring]}}]});
  assert.equal(geo.features[0].geometry.coordinates[0].length,ring.length);
});
