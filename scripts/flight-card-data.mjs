// Contract for the display projection consumed by the static flight card.
// Source authority remains the Obsidian flight archive; this module only
// validates the derived shape before rendering.
export function validateFlightCardData(data) {
  const m = data?.meta;
  for (const key of ['flightCount', 'plannedCount', 'totalKm', 'totalMinutes', 'countries', 'cities', 'airports', 'airlines', 'firstYear', 'lastYear', 'earthKm']) {
    if (!Number.isFinite(m?.[key]) || m[key] < 0) throw new Error(`缺少有效数据：meta.${key}`);
  }
  if (!m.earthKm || !m.totalMinutes) throw new Error('赤道长度与累计时长必须大于零');
  for (const key of ['countries', 'airportPoints', 'arcs']) {
    if (!Array.isArray(data[key])) throw new Error(`缺少数组：${key}`);
  }
  if (new Set(data.countries.map(c => c.name)).size !== m.countries) throw new Error('国家名单与统计不一致');
  if (data.airportPoints.length !== m.airports) throw new Error('机场点位与统计不一致');
  if (data.arcs.length !== m.flightCount + m.plannedCount) throw new Error('航线与航程数量不一致');
  if (!data.airportPoints.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.lat >= -90 && p.lat <= 90 && p.lon >= -180 && p.lon <= 180)) {
    throw new Error('机场坐标缺失或超出范围');
  }
  if (data.flights) {
    const sum = key => data.flights.reduce((n, f) => n + f[key], 0);
    if (sum('km') !== m.totalKm || sum('durationMinutes') !== m.totalMinutes) throw new Error('航段明细与里程/时长合计不一致');
  }
  return data;
}
