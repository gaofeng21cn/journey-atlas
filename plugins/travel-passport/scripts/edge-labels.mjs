import { arcPath } from './route-geometry.mjs';
import { canonicalName } from './travel-layers.mjs';

// 国际边缘节点只收口“一端在地区内、另一端在地区外”的真正跨区路线。
// 这样香港、伊斯坦布尔等虽然落在地图矩形内，也不会被误当成地区内部节点；
// 同时不会把美国—加拿大、意大利—梵蒂冈这类区域内往返支线重复标到页边。
const countryOf = (ref, fallback) => {
  const value = ref?.country || fallback || '';
  return String(value).split('；').filter(Boolean)[0] || '';
};

export function endpointCountries(route) {
  const refs = route.nodeRefs || [];
  const fallback = route.countries || [];
  const first = countryOf(refs[0], fallback[0]);
  const last = countryOf(refs.at(-1), fallback.at(-1));
  return [first, last];
}

export function borderRouteEndpoints(route, regionCountries) {
  if(route.candidate||route.structuralLink||route.recordType==='资料间隔')return null;
  const points = route.displayPoints || route.points;
  const names = route.displayNames || route.names;
  if (!Array.isArray(points) || points.length < 2 || !Array.isArray(names) || names.length !== points.length) return null;
  const [firstCountry, lastCountry] = endpointCountries(route);
  if (!firstCountry || !lastCountry) return null;
  const insideFirst = regionCountries.includes(firstCountry);
  const insideLast = regionCountries.includes(lastCountry);
  if (insideFirst === insideLast) return null;
  const homeIndex = insideFirst ? 0 : points.length - 1;
  const awayIndex = insideFirst ? points.length - 1 : 0;
  return {
    route,
    home: points[homeIndex],
    away: points[awayIndex],
    homeName: names[homeIndex],
    awayName: names[awayIndex],
    mode: route.mode || '飞机',
  };
}

const dateKey = value => {
  const m = String(value || '').match(/(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  return m ? [Number(m[1]), Number(m[2] || 1), Number(m[3] || 1)] : [9999, 99, 99];
};
const compareDate = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const routeNames = route => route.displayNames || route.names || [];
const sameName = (a, b, aliases) => canonicalName(a, aliases) === canonicalName(b, aliases);

// A region edge may be preceded/followed by an overseas transfer leg. For the
// For a connecting itinerary this turns Origin→Transfer→Destination into a readable
// Origin→Destination connector while retaining the transfer flight in data.
export function expandExternalGateway(edge, routes = [], regionCountries = [], aliases) {
  if (!edge) return null;
  let current = { ...edge };
  const seen = new Set([edge.route?.id]);
  const outbound = edge.home === (edge.route.displayPoints || edge.route.points)[0];
  for (let step = 0; step < 3; step++) {
    const currentPoints = current.route.displayPoints || current.route.points;
    const currentStart = dateKey(current.route.startDate || current.route.date);
    const currentEnd = dateKey(current.route.endDate || current.route.date);
    const candidates = routes.filter(candidate => {
      if (!candidate || seen.has(candidate.id) || candidate.journeyId !== current.route.journeyId) return false;
      const points = candidate.displayPoints || candidate.points, names = routeNames(candidate);
      if (!points || points.length < 2 || !names.length) return false;
      const countries = endpointCountries(candidate);
      if (countries.some(country => regionCountries.includes(country))) return false;
      if (outbound) return sameName(names[0], current.awayName, aliases) && compareDate(dateKey(candidate.startDate || candidate.date), currentEnd) >= 0;
      return sameName(names.at(-1), current.awayName, aliases) && compareDate(dateKey(candidate.endDate || candidate.date), currentStart) <= 0;
    });
    if (!candidates.length) break;
    candidates.sort((a, b) => {
      const ka = dateKey(a.startDate || a.date), kb = dateKey(b.startDate || b.date);
      return outbound ? compareDate(ka, kb) : compareDate(kb, ka);
    });
    const next = candidates[0], points = next.displayPoints || next.points, names = routeNames(next);
    seen.add(next.id);
    current = outbound
      ? { ...current, away: points.at(-1), awayName: names.at(-1) }
      : { ...current, away: points[0], awayName: names[0] };
    current.route = next;
  }
  return current;
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const clampPoint = ([lat, lon], bounds) => [clamp(lat, bounds[1], bounds[3]), clamp(lon, bounds[0], bounds[2])];
const initialBearing = ([lat1, lon1], [lat2, lon2]) => {
  const f1 = lat1 * Math.PI / 180, f2 = lat2 * Math.PI / 180;
  const d = ((lon2 - lon1 + 540) % 360 - 180) * Math.PI / 180;
  return Math.atan2(
    Math.sin(d) * Math.cos(f2),
    Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(d),
  ) * 180 / Math.PI;
};
export const goesEast = (from, to) => Math.sin(initialBearing(from, to) * Math.PI / 180) >= 0;

/**
 * Render cross-region routes as Flighty-like page-edge labels.
 * `project` is the map projection and `extent` is the map frame [x,y,w,h].
 */
export function renderEdgeLabels({ routes, gatewayRoutes = routes, regionCountries, bounds, project, extent, aliases, gap = 30, clipId = 'frame0', rail = 104, labelPadding = 90, verticalPadding = 12, bottomPadding = 12, viewBoxWidth = 1000, collapseGateways = false }) {
  const [bx0, by0, width, height] = extent;
  const bx1 = bx0 + width, by1 = by0 + height;
  const safeTop = by0 + verticalPadding;
  const safeBottom = by1 - bottomPadding;
  const groups = new Map();
  for (const route of routes || []) {
    const rawEdge = borderRouteEndpoints(route, regionCountries);
    const edge = collapseGateways ? expandExternalGateway(rawEdge, gatewayRoutes, regionCountries, aliases) : rawEdge;
    if (!edge) continue;
    const awayName = canonicalName(edge.awayName, aliases);
    const homeName = canonicalName(edge.homeName, aliases);
    if (!awayName || !homeName) continue;
    const east = goesEast(edge.home, edge.away);
    const key = `${east ? 'E' : 'W'}|${awayName}`;
    if (!groups.has(key)) groups.set(key, { east, awayName, links: new Map(), awayLats: [] });
    groups.get(key).awayLats.push(edge.away[0]);
    groups.get(key).links.set(`${homeName}|${edge.mode}`, { point: project(clampPoint(edge.home, bounds)), mode: edge.mode });
  }
  const list = [...groups.values()];
  for (const group of list) {
    // Use the real overseas endpoint latitude for the side-rail order. The
    // old implementation used the local departure point, which made Detroit
    // and Shimonoseki (下关) nearly collide despite being far apart north to
    // south geographically.
    group.edgeLat = group.awayLats.reduce((sum, lat) => sum + lat, 0) / group.awayLats.length;
    const projected = project([group.edgeLat, bounds[0]])?.[1];
    group.y = Number.isFinite(projected) ? projected : by0 + height / 2;
    group.y = Math.min(safeBottom, Math.max(safeTop, group.y));
  }
  // Pack each side independently so a dense left rail cannot push the right
  // rail out of geographic order (or vice versa).
  for (const east of [false, true]) {
    // Sort before clipping: two northern cities may both be clipped to the
    // top of the frame but must still preserve their real geographic order.
    const side = list.filter(group => group.east === east).sort((a, b) => b.edgeLat - a.edgeLat || a.awayName.localeCompare(b.awayName));
    const actualGap = Math.min(gap, (safeBottom - safeTop) / Math.max(side.length - 1, 1));
    side.forEach((group, i) => {
      const lower = safeTop + i * actualGap;
      const upper = safeBottom - (side.length - 1 - i) * actualGap;
      group.y = clamp(group.y, lower, upper);
      if (i) group.y = Math.max(group.y, side[i - 1].y + actualGap);
    });
  }

  const parts = [];
  for (const group of list) {
    // Keep the edge dot inside a reserved side rail. The label then points
    // outward, away from the regional map, so the route, dot, and text form a
    // single readable chain instead of occupying the map's core.
    const x = group.east ? bx1 - rail : bx0 + rail;
    for (const { point, mode } of group.links.values()) {
      const classes = `jp-route edge${mode === '飞机' ? ' air' : ''}`;
      parts.push(`<path class="${classes}" data-edge="true" data-edge-mode="${mode}" clip-path="url(#${clipId})" d="${arcPath(point, [x, group.y], mode)}"/>`);
    }
    const tx = group.east
      ? Math.min(viewBoxWidth - labelPadding, bx1 - labelPadding)
      : Math.max(labelPadding, bx0 + labelPadding);
    const anchor = group.east ? 'start' : 'end';
    const leaderDx = tx - x;
    parts.push(
      `<circle class="jp-edge-dot" data-edge-label="true" cx="${x.toFixed(1)}" cy="${group.y.toFixed(1)}" r="2.6"/>` +
      `<path class="jp-leader" d="M${x.toFixed(1)},${group.y.toFixed(1)}h${leaderDx.toFixed(1)}"/>` +
      `<text class="jp-label jp-edge-label" data-edge-label="true" x="${tx.toFixed(1)}" y="${(group.y + 5).toFixed(1)}" text-anchor="${anchor}">${String(group.awayName).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))}</text>`,
    );
  }
  return { svg: parts.join(''), groups: list.length, paths: list.reduce((n, group) => n + group.links.size, 0) };
}
