import test from 'node:test';
import assert from 'node:assert/strict';
import {hubConnectors, hubRows, HUB_HEADERS} from '../scripts/hub-links.mjs';

const route = (id, names, points, date, ids) => ({id, names, points, date, nodeIds: ids, mode: '飞机'});
const routes = [
  route('R1', ['Airport Alpha', 'City Alpha'], [[10, 20], [20, 30]], '2030-03-05—2030-03-09', ['AIRPORT-ALPHA', 'CITY-ALPHA']),
  route('R2', ['Airport Beta', 'Airport Gamma'], [[30, 40], [40, 50]], '2030-04', ['AIRPORT-BETA', 'AIRPORT-GAMMA']),
];
const trajectory = [
  {交通编号: 'R1', 路线段: '1/1', 日期: routes[0].date, 到达地: 'City Alpha', 到达纬度: 20, 到达经度: 30, 到达节点编号: 'CITY-ALPHA', 接续状态: '链条起点', 所属行程编号: 'J1'},
  {交通编号: 'R2', 路线段: '1/1', 日期: routes[1].date, 出发地: 'Airport Beta', 出发纬度: 30, 出发经度: 40, 出发节点编号: 'AIRPORT-BETA', 接续状态: '断点', 所属行程编号: 'J2'},
];

test('跨国缺口只生成待还原接续，不推定航班、里程或具体发生日', () => {
  const [c] = hubConnectors(trajectory, routes);
  assert.equal(c.candidate, true);
  assert.equal(c.countDistance, false);
  assert.equal(c.mode, '交通方式待定');
  assert.equal(c.km, null);
  assert.equal(c.startDate, '2030-03-09');
  assert.equal(c.endDate, '2030-04');
  assert.equal(c.date, '2030-03-09—2030-04');
  assert.equal(c.covered, undefined);
  assert.deepEqual([c.previousTransport, c.nextTransport, c.previousSegment, c.nextSegment], ['R1', 'R2', 1, 1]);
  assert.equal(hubRows([c])[0]['里程公里'], '');
  assert.equal(hubRows([c])[0]['核定结论'], '待还原');
  assert.ok(HUB_HEADERS.includes('前序路线段'));
});

test('相近日期或反向城市对不会证明另一个移动实例已经覆盖', () => {
  const other = route('R3', ['Airport Beta', 'City Alpha'], [routes[1].points[0], routes[0].points[1]], '2030-03-15', ['AIRPORT-BETA', 'CITY-ALPHA']);
  const [c] = hubConnectors(trajectory, [...routes, other]);
  assert.equal(c.covered, undefined);
  assert.equal(c.km, null);
});

test('候选保留原始机场端点；服务城市展示聚合不改变身份', () => {
  const bound = routes.map(r => ({...r, displayNames: ['展示城市甲', '展示城市乙'], displayPoints: [[0, 0], [1, 1]]}));
  const [c] = hubConnectors(trajectory, bound);
  assert.equal(c.fromName, 'City Alpha');
  assert.equal(c.toName, 'Airport Beta');
  assert.deepEqual(c.to, [30, 40]);
  assert.equal(c.toNodeId, 'AIRPORT-BETA');
});

test('增删其它路线或候选不改变同一缺口的稳定编号', () => {
  const [c] = hubConnectors(trajectory, routes);
  const unrelated = [
    {交通编号: 'X1', 路线段: '1/1', 日期: '2002', 到达地: '甲', 到达纬度: 1, 到达经度: 1, 到达节点编号: 'A', 接续状态: '链条起点'},
    {交通编号: 'X2', 路线段: '1/1', 日期: '2002', 出发地: '乙', 出发纬度: 2, 出发经度: 2, 出发节点编号: 'B', 接续状态: '断点'},
  ];
  const withOthers = hubConnectors([...unrelated, ...trajectory], [...routes].reverse());
  assert.equal(withOthers.find(x => x.previousTransport === 'R1').id, c.id);
});

test('人工接驳的纳入及排除均阻止同一前后移动的候选再生', () => {
  const managed = {...route('M1', ['City Alpha', 'Airport Beta'], [routes[0].points[1], routes[1].points[0]], '2030-03—2030-04', ['CITY-ALPHA', 'AIRPORT-BETA']),
    recordType: '接驳段', previousTransport: 'R1', nextTransport: 'R2'};
  for (const include of [true, false]) assert.deepEqual(hubConnectors(trajectory, routes, {managed: [{...managed, include}]}), []);
  assert.equal(hubConnectors(trajectory, routes, {managed: [{...managed, previousTransport: 'OTHER'}]}).length, 1);
  assert.equal(hubConnectors(trajectory, routes, {managed: [{...managed, nodeIds: ['OTHER', 'AIRPORT-BETA']}]}).length, 1);
  assert.equal(hubConnectors(trajectory, routes, {managed: [{...managed, previousSegment: 2}]}).length, 1);
});

test('同一城市不同物理端点的缺口仍留待还原，不被别名消除', () => {
  const rows = [{...trajectory[0], 到达地: 'Metro Alpha', 到达节点编号: 'AIRPORT-ALPHA'}, {...trajectory[1], 出发地: 'Metro Alpha', 出发节点编号: 'AIRPORT-DELTA'}];
  const [c] = hubConnectors(rows, [], {aliases: new Map([['Airport Alpha', 'Metro Alpha'], ['Airport Delta', 'Metro Alpha']])});
  assert.deepEqual([c.fromNodeId, c.toNodeId], ['AIRPORT-ALPHA', 'AIRPORT-DELTA']);
  assert.equal(c.km, null);
});
