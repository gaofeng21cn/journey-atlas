// Gateway labels are a display projection of route endpoints. They must not
// create a second place identity or expose reconstruction helper names.
const cleanName = value => String(value || '')
  .replace(/\s*[（(][^（）()]*[）)]/g, '')
  .replace(/·迪士尼海洋$/, '')
  .trim();

const locality = value => cleanName(value)
  .replace(/周边$/, '')
  .replace(/特别行政区$/, '')
  .replace(/市$/, '')
  .trim();

const distanceKm = (a, b) => {
  const rad = n => n * Math.PI / 180;
  const [lat1, lon1] = a.map(rad), [lat2, lon2] = b.map(rad);
  const h = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
};

const unknownName = name => !name || /位置记录$/.test(name) || /^(同日城市接续|区域接续)$/.test(name);

const catalogName = value => locality(String(value || '').replace(/^中国(?:香港|澳门|台湾)?[·\s]/, ''));

const nearestCatalog = (node, catalog) => catalog
  .filter(c => !node.country || !c.country || c.country === node.country)
  .map(c => ({c, distance: distanceKm([node.lat, node.lon], [c.lat, c.lon])}))
  .sort((a, b) => a.distance - b.distance)[0];

const sameDisplayName = (a, b) => catalogName(a) === catalogName(b);

// Curated route/airport identities are stronger than the public backdrop
// catalogue.  The latter is only a deterministic reverse-geocoding fallback
// for unnamed GPS endpoints; it must never replace an explicit route city.
const namedCatalogMatch = (name, catalog) => catalog
  .filter(c => sameDisplayName(c.canonical || c.name, name))
  .sort((a, b) => Number(b.source !== 'public-city') - Number(a.source !== 'public-city'))[0];

export const UNKNOWN_GATEWAY_LABEL = '外部城市待识别';
export const UNKNOWN_GATEWAY_DESCRIPTION = '有外部移动记录，但原始端点只有定位坐标，尚未核定城市名称';

/** Return one stable display identity for a page-edge endpoint. */
export function gatewayIdentity(node, {scope, catalog = []} = {}) {
  const raw = cleanName(node?.name);
  // Flight records retain the physical airport/station name and its service
  // city separately. The city projection uses the service city so Shanghai
  // Hongqiao and Pudong do not become two unrelated gateways.
  const service = !unknownName(node?.serviceName) ? catalogName(node.serviceName) : '';
  const explicit = service || (!unknownName(raw) ? locality(raw) : '');
  const localName = locality(scope?.name || '');
  const sameCity = Boolean(node?.cityId && scope?.cityId && node.cityId === scope.cityId);
  // Preserve an explicit transport/airport endpoint. A generic exact city
  // name, however, is a local continuation when it sits outside the focus
  // window (for example, Guangzhou's airport or suburban GPS endpoint).
  if (sameCity || explicit === localName) {
    const name = `${scope?.name || '本地'}周边`;
    return {key: `local|${scope?.id || scope?.cityId || name}`, name, kind: 'local', source: 'scope'};
  }
  const nearest = nearestCatalog(node, catalog);
  const focusBounds = scope?.mapBounds || scope?.bounds;
  const focusCenter = focusBounds ? [(focusBounds[1] + focusBounds[3]) / 2, (focusBounds[0] + focusBounds[2]) / 2] : null;
  const focusDistance = focusCenter ? distanceKm([node.lat, node.lon], focusCenter) : Infinity;
  // An explicit name outranks the broad map bounds: a nearby named city such
  // as Foshan may physically fall inside the administrative context window,
  // but it is still a real external endpoint.
  if (explicit) {
    const match = namedCatalogMatch(explicit, catalog);
    const name = catalogName(match?.canonical || match?.name || explicit);
    return {key: `city|${match?.country || node.country || ''}|${name}`, name, kind: focusDistance <= 120 ? 'nearby' : 'city', source: service ? 'service-city' : match ? match.source || 'catalog' : 'name'};
  }

  const broad = scope?.bounds;
  if (sameCity || broad && node.lon >= broad[0] && node.lon <= broad[2] && node.lat >= broad[1] && node.lat <= broad[3]) {
    const name = `${scope?.name || '本地'}周边`;
    return {key: `local|${scope?.id || scope?.cityId || name}`, name, kind: 'local', source: 'scope'};
  }

  // Adjacent cities remain named, but get an explicit category for layout and
  // counting. This prevents local/nearby endpoints being mixed with overseas
  // and long-distance gateways.
  // Public city points are deliberately limited to a tighter radius than
  // curated airports/stations.  This resolves an unnamed airport or GPS
  // endpoint near a real city without turning a remote scenic point into an
  // invented gateway.
  const nearestLimit = nearest?.c?.source === 'public-city' ? 90 : 120;
  if (nearest && nearest.distance <= nearestLimit) {
    const name = catalogName(nearest.c.canonical || nearest.c.name);
    return {key: `city|${nearest.c.country || node.country || ''}|${name}`, name, kind: focusDistance <= 120 ? 'nearby' : 'city', source: nearest.c.source || 'catalog', distanceKm: Math.round(nearest.distance * 10) / 10};
  }
  if (explicit) return {key: `city|${node.country || ''}|${explicit}`, name: explicit, kind: 'city', source: service ? 'service-city' : 'name'};
  const name = UNKNOWN_GATEWAY_LABEL;
  return {key: `other|${node.country || ''}`, name, kind: 'unknown', source: 'unknown', description: UNKNOWN_GATEWAY_DESCRIPTION};
}

export {cleanName, locality};
