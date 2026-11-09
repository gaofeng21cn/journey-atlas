import test from 'node:test';
import assert from 'node:assert/strict';
import { isRecordedMovement, isStructuralRoute, orderedDisplayRoutes } from '../src/route-semantics.mjs';
import { routeSegments } from '../scripts/route-geometry.mjs';
import { renderRegionMap } from '../scripts/region-map.mjs';
import { japanMap } from '../scripts/japan-map.mjs';

const route = (id, extra = {}) => ({
  id, mode: '公路', points: [[0, 0], [.2, .2]], names: ['甲', '乙'], countries: ['区域'], ...extra,
});

test('统一显示语义排除候选与撤回，资料间隔和区域接续只保留结构身份', () => {
  const recorded = route('REAL'), planned = route('PLAN', { status: '计划' });
  const structural = [
    route('STRUCTURAL', { structuralLink: true }),
    route('INTERVAL', { recordType: '资料间隔' }),
    route('CONTINUITY', { continuityType: '资料间隔' }),
    route('COARSE', { recordType: '区域接续' }),
    route('UNRESTORED', { occurrenceStatus: '待还原' }),
    route('UNKNOWN', { countDistance: false, mode: '接续方式待核' }),
  ];
  assert.ok(structural.every(isStructuralRoute));
  assert.ok(structural.every(r => !isRecordedMovement(r)));
  assert.ok(isRecordedMovement(recorded));
  assert.ok(isRecordedMovement(planned)); // Existing posters include registered plans.
  const hidden = [route('CANDIDATE', { candidate: true }), route('WITHDRAWN', { occurrenceStatus: '排除' }), route('EXCLUDED', { include: false })];
  assert.ok(hidden.every(r => !isRecordedMovement(r)));
  assert.deepEqual(orderedDisplayRoutes([...structural, ...hidden, recorded, planned]), [recorded, planned, ...structural]);
});

test('真实同向移动压过未知连接，不把结构线加入频次，往返方向独立', () => {
  const unknown = route('LINK', { structuralLink: true, mode: '交通方式待定', countDistance: false, km: null });
  const real = route('REAL', { recordType: '旅行航段', mode: '铁路', km: 30, distanceType: 'model', geometryType: 'display' });
  const reverse = { ...unknown, id: 'REVERSE', points: [...unknown.points].reverse() };
  const legs = routeSegments([unknown, real, { ...real, id: 'REPEAT' }, reverse, route('CANDIDATE', { candidate: true })]);
  assert.equal(legs.length, 2);
  assert.equal(legs[0].count, 2);
  assert.equal(legs[0].mode, '铁路');
  assert.equal(legs[0].structuralLink, false);
  assert.equal(legs[0].distanceType, 'model');
  assert.equal(legs[0].geometryType, 'display');
  assert.deepEqual(legs[0].routeIds, ['REAL', 'REPEAT']);
  assert.equal(legs[1].count, 0);
  assert.equal(legs[1].structuralLink, true);
  assert.equal(legs[1].countDistance, false);
  assert.equal(legs[1].km, null);
  assert.deepEqual(legs[1].a, unknown.points[1]);
});

test('相同结构连接只合并笔画，原有资料间隔元数据不丢失', () => {
  const interval = route('GAP', { recordType: '资料间隔', continuityType: '资料间隔', countDistance: false,
    previousTransport: 'IN', nextTransport: 'OUT', occurrenceStatus: '待还原' });
  const legs = routeSegments([interval, { ...interval, id: 'GAP2', mode: '接续方式待核' }]);
  assert.equal(legs.length, 1);
  assert.equal(legs[0].recordType, '资料间隔');
  assert.equal(legs[0].continuityType, '资料间隔');
  assert.equal(legs[0].previousTransport, 'IN');
  assert.equal(legs[0].nextTransport, 'OUT');
  assert.equal(legs[0].count, 0);
});

test('地区静态图只给已登记移动生成海外节点，内部未知连接保持淡线标识', () => {
  const config = { name: '示例', units: [{ id: 'U', name: '单元' }], countries: ['区域'],
    bounds: [-1, -1, 1, 1], step: 2, labels: [], source: '示例', edgeLabels: {} };
  const geo = { features: [{ type: 'Feature', id: 'U', geometry: { type: 'Polygon',
    coordinates: [[[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5], [-.5, -.5]]] } }] };
  const border = route('BORDER', { mode: '飞机', names: ['甲', '实际海外'], points: [[0, 0], [0, 10]], countries: ['区域', '海外'] });
  const view = { units: [{ id: 'U', active: false }], places: [],
    routes: [route('REAL'), route('UNKNOWN', { structuralLink: true, points: [[.2, .2], [.3, .3]] }), route('CANDIDATE', { candidate: true })],
    border: [border, { ...border, id: 'UNKNOWN-BORDER', names: ['甲', '未恢复海外'], recordType: '区域接续' },
      { ...border, id: 'CANDIDATE-BORDER', names: ['甲', '候选海外'], candidate: true }] };
  const map = renderRegionMap(config, geo, view);
  assert.match(map.svg, /实际海外/);
  assert.doesNotMatch(map.svg, /未恢复海外|候选海外/);
  assert.equal([...map.svg.matchAll(/data-edge="true"/g)].length, 1);
  assert.equal([...map.svg.matchAll(/data-route="true"/g)].length, 2);
  assert.match(map.svg, /class="jp-route structural"[^>]*data-type="structural"[^>]*data-count="0"/);
  assert.match(map.svg, /data-type="movement"[^>]*data-count="1"/);
});

test('地区静态图从实际地点和路线自动标注，不依赖个人精选标签',()=>{
  const config={name:'虚构区域',units:[{id:'U',name:'单元'}],countries:['区域'],bounds:[-1,-1,1,1],step:2,source:'虚构地图'};
  const geo={features:[{type:'Feature',id:'U',geometry:{type:'Polygon',coordinates:[[[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]]]}}]};
  const places=[{id:'A',name:'示例甲城',active:true,lat:-.5,lon:-.5},{id:'B',name:'示例乙城',active:true,lat:0,lon:0},{id:'C',name:'示例丙城',active:true,lat:.5,lon:.5}];
  const view={units:[{id:'U',active:true}],places,routes:[route('R',{names:places.map(p=>p.name),points:places.map(p=>[p.lat,p.lon])})]};
  const map=renderRegionMap(config,geo,view);
  assert.equal([...map.svg.matchAll(/data-place-label=/g)].length,3);
  for(const p of places)assert.match(map.svg,new RegExp(`data-place-label="${p.id}"[^>]*>${p.name}</text>`));
  assert.doesNotMatch(map.svg,/NaN|undefined/);
  assert.equal(renderRegionMap({...config,labels:[['个人精选',999,999]]},geo,view).svg,map.svg);
});

test('日本本土及冲绳边缘同样不将结构连接或候选显示为跨境航线', () => {
  const prefectures = Array.from({ length: 47 }, (_, i) => ({ id: String(i + 1).padStart(2, '0'), name: `单元${i + 1}`, visited: false }));
  const topology = { type: 'Topology', objects: { japan: { type: 'GeometryCollection',
    geometries: prefectures.map((p, i) => ({ type: 'Polygon', properties: { id: p.id }, arcs: [[i]] })) } },
    arcs: prefectures.map(p => p.id === '47'
      ? [[127, 26], [127.02, 26], [127.02, 26.02], [127, 26.02], [127, 26]]
      : [[130, 35], [130.02, 35], [130.02, 35.02], [130, 35.02], [130, 35]]) };
  const border = route('BORDER', { mode: '飞机', names: ['日本本土', '实际海外'], points: [[35, 135], [30, 115]], countries: ['日本', '海外'] });
  const atlas = { prefectures, places: [], japan: { visited: 0, cities: 0 }, routes: [
    border, { ...border, id: 'MAIN-GAP', names: ['日本本土', '本土未知海外'], countDistance: false, mode: '接续方式待核' },
    { ...border, id: 'INSET-GAP', names: ['冲绳', '离岛未知海外'], points: [[26, 127], [22, 114]], occurrenceStatus: '待还原' },
    { ...border, id: 'INSET-CANDIDATE', names: ['冲绳', '离岛候选海外'], points: [[26, 127], [22, 114]], candidate: true },
    route('INTERNAL-GAP', { points: [[35, 135], [36, 136]], countries: ['日本'], structuralLink: true }),
  ] };
  const svg = japanMap(topology, atlas);
  assert.match(svg, /实际海外/);
  assert.doesNotMatch(svg, /本土未知海外|离岛未知海外|离岛候选海外/);
  assert.equal([...svg.matchAll(/data-edge="true"/g)].length, 1);
  assert.match(svg, /class="jp-route structural"[^>]*data-type="structural"[^>]*data-count="0"/);
});
