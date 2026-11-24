// Shared geographic helpers backed by @turf/*.
// Point coordinates follow the existing caller conventions:
// - greatCircleKm / greatCircleRad take [lat, lon] pairs.
// - pointInRing / pointInPolygon / pointInFeature take GeoJSON [lon, lat] points.
import turfBbox from '@turf/bbox';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import turfDistance from '@turf/distance';

export function greatCircleKm([lat1, lon1], [lat2, lon2]) {
  return turfDistance([lon1, lat1], [lon2, lat2], { units: 'kilometers' });
}

export function greatCircleRad([lat1, lon1], [lat2, lon2]) {
  return turfDistance([lon1, lat1], [lon2, lat2], { units: 'radians' });
}

function closeRing(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

export function pointInRing(point, ring) {
  const closed = closeRing(ring);
  if (!closed) return false;
  return booleanPointInPolygon(point, { type: 'Polygon', coordinates: [closed] });
}

export function pointInPolygon(point, coordinates) {
  if (!Array.isArray(coordinates) || !coordinates.length) return false;
  const rings = coordinates.map(closeRing).filter(Boolean);
  if (!rings.length) return false;
  return booleanPointInPolygon(point, { type: 'Polygon', coordinates: rings });
}

export function pointInFeature(point, feature) {
  const geometry = feature?.geometry ?? feature;
  if (!geometry) return false;
  if (geometry.type === 'Polygon') {
    return pointInPolygon(point, geometry.coordinates);
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some(poly => pointInPolygon(point, poly));
  }
  return false;
}

export function bboxOf(geojson) {
  return turfBbox(geojson?.geometry ?? geojson);
}

export function polygonBbox(coordinates) {
  return turfBbox({ type: 'Polygon', coordinates });
}

export function unwrapAntimeridianPolygons(feature) {
  const geometry = feature?.geometry ?? feature;
  if (!geometry) return [];
  const polys = geometry.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon'
      ? geometry.coordinates
      : [];
  if (!polys.length) return [];
  const [minLon, , maxLon] = turfBbox(geometry);
  if (maxLon - minLon <= 180) return polys;
  let neg = 0;
  let pos = 0;
  for (const poly of polys) {
    for (const ring of poly) {
      for (const [lon] of ring) {
        if (lon < 0) neg++;
        else if (lon > 0) pos++;
      }
    }
  }
  if (neg <= pos) return polys;
  return polys.map(poly => poly.map(ring => ring.map(([lon, lat]) => [lon > 0 ? lon - 360 : lon, lat])));
}
