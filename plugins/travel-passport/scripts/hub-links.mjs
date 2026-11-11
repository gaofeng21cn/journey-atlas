// 接续候选只说明相邻已登记移动之间尚有路径未还原。
// 它不证明交通方式、发生日或里程，也不能把待核缺口变成事实连续。
import { createHash } from 'node:crypto';
import { canonicalName, routeNames } from './travel-layers.mjs';

export const HUB_LINKS = '全旅程数据点-枢纽接驳.csv';
export const HUB_HEADERS = ['接驳编号', '日期', '开始日期', '结束日期', '时间精度',
  '出发地', '到达地', '出发节点编号', '到达节点编号', '出发地点编号', '到达地点编号',
  '交通方式', '里程公里', '里程依据', '发生依据', '接续说明', '核定结论', '分享计程',
  '前序交通编号', '后序交通编号', '前序路线段', '后序路线段',
  '上一行程编号', '下一行程编号', '关联正文'];

// 保留供已有调用方查询航空枢纽；枢纽身份不参与自动核定移动。
export function hubNodes(routes, aliases) {
  const hubs = new Set();
  for (const r of routes) if (r.mode === '飞机') {
    for (const n of routeNames(r)) hubs.add(canonicalName(n, aliases));
  }
  return hubs;
}

const field = (r, key, sourceKey) => r?.[key] ?? r?.[sourceKey] ?? '';
const routeId = r => field(r, 'id', '交通编号');
const segment = row => String(row['路线段'] || '');
const segmentNumber = value => {
  const n = Number(String(value || '').split('/')[0]);
  return Number.isInteger(n) && n >= 1 ? n : null;
};
const dateBoundary = (row, route, side) => {
  const key = side === 'start' ? '开始日期' : '结束日期';
  const prop = side === 'start' ? 'startDate' : 'endDate';
  const explicit = row[key] || route?.[prop];
  if (explicit) return String(explicit);
  const dates = String(row['日期'] || route?.date || '').match(/\d{4}(?:-\d{2}(?:-\d{2})?)?/g) || [];
  return side === 'start' ? dates[0] || '' : dates.at(-1) || '';
};

// 对照实际交通原值取端点，不能拿服务城市的展示坐标证明物理接续。
function endpoint(row, route, side) {
  const arriving = side === 'to';
  const label = arriving ? '到达' : '出发';
  const points = route?.points;
  const leg = Number(segment(row).split('/')[0]);
  const index = points?.length
    ? Number.isInteger(leg) && leg >= 1 && leg < points.length ? leg - (arriving ? 0 : 1) : arriving ? points.length - 1 : 0
    : null;
  const point = index === null ? [Number(row[label + '纬度']), Number(row[label + '经度'])] : points[index];
  return {
    point,
    name: index === null ? row[label + '地'] : route.names?.[index] || row[label + '地'],
    nodeId: index === null ? row[label + '节点编号'] || '' : route.nodeIds?.[index] || row[label + '节点编号'] || '',
    placeId: index === null ? row[label + '地点编号'] || '' : route.nodePlaceIds?.[index] || row[label + '地点编号'] || '',
  };
}

const endpointKey = e => e.nodeId || 'point:' + e.point.join(',') + '|name:' + (e.name || '');
const managedEndpoint = (r, arriving) => {
  const ids = r.nodeIds || String(r['节点编号序列'] || '').split('；').filter(Boolean);
  const points = r.points;
  const names = r.names || String(r['途经节点'] || '').split('；');
  const index = arriving ? (ids.length || points?.length || names.length) - 1 : 0;
  return {nodeId: ids[index] || '', point: points?.[index] || [], name: names[index] || ''};
};
const matchesEndpoint = (managed, candidate) => {
  if (managed.nodeId && candidate.nodeId) return managed.nodeId === candidate.nodeId;
  return endpointKey(managed) === endpointKey(candidate);
};

// 纳入与排除的可维护接驳都优先于候选。只匹配这次前后移动及真实端点，
// 不能因为另一次旅行有同名城市对，就重复消费其路线或抑制当前缺口。
function hasManagedConnection(managed, before, after, beforeSegment, afterSegment, from, to) {
  return managed.some(r => ['接驳段','节点对应'].includes(field(r, 'recordType', '记录类型'))
    && field(r, 'previousTransport', '前序交通编号') === before
    && field(r, 'nextTransport', '后序交通编号') === after
    && (!field(r, 'previousSegment', '前序路线段') || segmentNumber(field(r, 'previousSegment', '前序路线段')) === beforeSegment)
    && (!field(r, 'nextSegment', '后序路线段') || segmentNumber(field(r, 'nextSegment', '后序路线段')) === afterSegment)
    && matchesEndpoint(managedEndpoint(r, false), from)
    && matchesEndpoint(managedEndpoint(r, true), to));
}

// 每个候选的身份由前后移动、具体段和端点组成，新增或重排其它记录不会改号。
export function hubConnectors(trajectory, routes, { managed = [] } = {}) {
  const byId = new Map(routes.map(r => [routeId(r), r]));
  const out = [], emitted = new Set();
  for (let i = 1; i < trajectory.length; i++) {
    const row = trajectory[i], previous = trajectory[i - 1];
    if (row['接续状态'] !== '断点') continue;
    const previousTransport = previous['交通编号'] || '', nextTransport = row['交通编号'] || '';
    const previousSegment = segmentNumber(segment(previous)), nextSegment = segmentNumber(segment(row));
    const previousRoute = byId.get(previousTransport), nextRoute = byId.get(nextTransport);
    const from = endpoint(previous, previousRoute, 'to'), to = endpoint(row, nextRoute, 'from');
    if (!from.name || !to.name || from.point.some(v => !Number.isFinite(v)) || to.point.some(v => !Number.isFinite(v))) continue;
    if (hasManagedConnection(managed, previousTransport, nextTransport, previousSegment, nextSegment, from, to)) continue;
    const identity = [previousTransport, previousSegment, endpointKey(from), nextTransport, nextSegment, endpointKey(to)];
    const id = 'HUB-' + createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 16);
    if (emitted.has(id)) continue;
    emitted.add(id);
    const startDate = dateBoundary(previous, previousRoute, 'end'), endDate = dateBoundary(row, nextRoute, 'start');
    const date = startDate && endDate ? startDate === endDate ? startDate : startDate + '—' + endDate : '未还原';
    out.push({
      id, candidate: true, countDistance: false, status: '待还原',
      fromName: from.name, toName: to.name, from: from.point, to: to.point,
      fromNodeId: from.nodeId, toNodeId: to.nodeId, fromPlaceId: from.placeId, toPlaceId: to.placeId,
      previousTransport, nextTransport, previousSegment, nextSegment,
      date, startDate, endDate, timePrecision: startDate && endDate ? '前后移动限定窗口' : '时间边界不完整',
      mode: '交通方式待定', km: null, basis: '',
      evidence: '必要接续：' + (previousTransport || '上一段') + '止于' + from.name + '，' + (nextTransport || '下一段') + '自' + to.name + '出发；中间移动的日期、方式及路径尚未还原',
      previousJourney: previous['所属行程编号'] || '', nextJourney: row['所属行程编号'] || '',
      source: row['关联正文'] || previous['关联正文'] || '',
    });
  }
  return out;
}

export const hubRows = connectors => connectors.map(c => ({
  接驳编号: c.id, 日期: c.date, 开始日期: c.startDate, 结束日期: c.endDate, 时间精度: c.timePrecision,
  出发地: c.fromName, 到达地: c.toName, 出发节点编号: c.fromNodeId, 到达节点编号: c.toNodeId,
  出发地点编号: c.fromPlaceId, 到达地点编号: c.toPlaceId, 交通方式: c.mode,
  里程公里: c.km ?? '', 里程依据: c.basis, 发生依据: c.evidence,
  接续说明: '必要但尚未还原的移动连接；不证明已恢复路径，不计入累计里程', 核定结论: '待还原', 分享计程: '不计入',
  前序交通编号: c.previousTransport, 后序交通编号: c.nextTransport,
  前序路线段: c.previousSegment, 后序路线段: c.nextSegment,
  上一行程编号: c.previousJourney, 下一行程编号: c.nextJourney, 关联正文: c.source,
}));
