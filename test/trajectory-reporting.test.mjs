import test from 'node:test';
import assert from 'node:assert/strict';
import {trajectoryRows, trajectorySummary, improvementRows} from '../scripts/travel-layers.mjs';
import {TRAJECTORY_HEADERS} from '../scripts/schema.mjs';

const route = (id, from, to, countDistance, km) => ({id, date: '2020-01-01', include: true,
  mode: countDistance ? '公路' : '交通方式待定', recordType: '旅行航段', status: '合理重构',
  names: [from, to], points: [[0, from], [0, to]], nodeIds: [String(from), String(to)],
  countDistance, km, source: '行程.md', distanceBasis: km === null ? '' : '已审核里程', sequence: to});
const atlasFor = routes => ({locationLayer: {places: []},
  journeyLayer: {journeys: [{id: 'J1', include: true, transportIds: routes.map(r => r.id), transport: routes}], unassigned: []},
  journeySummaries: []});

test('不计程未知接入不进入缺公里队列；真正计程但缺数值的边仍报告', () => {
  const routes = [route('机场接入', 0, 1, false, null), route('市区离开', 1, 2, false, null), route('已核城际', 2, 3, true, null)];
  const atlas = atlasFor(routes), rows = trajectoryRows(routes, atlas.journeyLayer.journeys);
  assert.deepEqual(rows.map(r => r['计程纳入']), ['否', '否', '是']);
  assert.ok(TRAJECTORY_HEADERS.includes('计程纳入'));
  const summary = trajectorySummary(rows);
  assert.equal(summary.missingKm, 1);
  assert.equal(summary.nonCountingLegs, 2);
  assert.equal(summary.unmeasuredNonCountingLegs, 2);
  assert.deepEqual(improvementRows(atlas).map(r => [r['类型'], r['对象编号']]), [['交通里程', '已核城际']]);
});

test('待还原连接与不计程已登记关系不会通过空公里或意外数值抬高统计', () => {
  const routes = [route('已核移动', 0, 1, true, 100), route('不计程关系', 1, 2, false, 999),
    {...route('待还原边', 2, 3, true, null), structuralLink: true, status: '待还原', recordType: '接驳段',
      previousTransport: '不计程关系', nextTransport: '后续已核移动', previousSegment: 1, nextSegment: 1},
    route('后续已核移动', 3, 4, true, 50)];
  const atlas = atlasFor(routes), rows = trajectoryRows(routes, atlas.journeyLayer.journeys);
  const summary = trajectorySummary(rows);
  assert.equal(summary.km, 150);
  assert.equal(summary.missingKm, 0);
  assert.equal(summary.pendingConnectors, 1);
  assert.equal(improvementRows(atlas).filter(r => r['类型'] === '交通里程').length, 0);
  assert.equal(trajectorySummary([{里程公里: 999, 计程纳入: '否'}]).km, 0);
});
