import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  bboxOf,
  greatCircleKm,
  greatCircleRad,
  pointInFeature,
  pointInPolygon,
  pointInRing,
  polygonBbox,
  unwrapAntimeridianPolygons,
} from '../plugins/travel-passport/src/geo.mjs';
import { ROOT } from '../plugins/travel-passport/scripts/data.mjs';

test('Turf-backed greatCircleKm and greatCircleRad match spherical geodesic distance', () => {
  // Tokyo (35.6762, 139.6503) to San Francisco (37.7749, -122.4194) ≈ 8280 km
  const km = greatCircleKm([35.6762, 139.6503], [37.7749, -122.4194]);
  assert.ok(km > 8250 && km < 8310, `unexpected distance: ${km}`);
  const rad = greatCircleRad([35.6762, 139.6503], [37.7749, -122.4194]);
  assert.ok(Math.abs(rad * 6371.0088 - km) < 0.01);
  assert.equal(greatCircleKm([31.23, 121.47], [31.23, 121.47]), 0);
});

test('Turf-backed pointInRing, pointInPolygon, and pointInFeature respect holes and open rings', () => {
  const outer = [[0, 0], [10, 0], [10, 10], [0, 10]]; // unclosed ring
  const hole = [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]];
  assert.equal(pointInRing([5, 5], outer), true);
  assert.equal(pointInRing([12, 5], outer), false);
  assert.equal(pointInPolygon([2, 2], [outer, hole]), true);
  assert.equal(pointInPolygon([5, 5], [outer, hole]), false);
  const feature = {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], hole],
    },
  };
  assert.equal(pointInFeature([2, 2], feature), true);
  assert.equal(pointInFeature([5, 5], feature), false);
  assert.deepEqual(bboxOf(feature), [0, 0, 10, 10]);
  assert.deepEqual(polygonBbox([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]), [0, 0, 10, 10]);
});

test('unwrapAntimeridianPolygons unwraps western antimeridian features without hardcoding US-AK', async () => {
  const usa = JSON.parse(await readFile(join(ROOT, 'data/usa.geojson'), 'utf8'));
  const alaska = usa.features.find(f => f.id === 'US-AK');
  const unwrapped = unwrapAntimeridianPolygons(alaska);
  const lons = unwrapped.flat(2).map(([lon]) => lon);
  assert.ok(Math.min(...lons) < -170 && Math.max(...lons) < -120);

  const europe = JSON.parse(await readFile(join(ROOT, 'data/europe.geojson'), 'utf8'));
  const russia = europe.features.find(f => f.id === 'RU');
  const russiaPolys = unwrapAntimeridianPolygons(russia);
  assert.equal(russiaPolys, russia.geometry.coordinates);
});

test('single-source plugin layout keeps runtime files solely inside plugins/travel-passport', async () => {
  const repoRoot = resolve(ROOT, '../..');
  const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+/);
  const inventory = JSON.parse(await readFile(join(repoRoot, 'package-runtime-files.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(ROOT, 'opl-package.json'), 'utf8'));
  assert.equal(existsSync(join(repoRoot, 'opl-package.json')), false);
  assert.equal(manifest.schema_version, 'opl.package.v2');
  assert.equal(manifest.identity.id, 'travel-passport');
  assert.equal(manifest.identity.version, pkg.version);
  assert.deepEqual(manifest.ui.declarative.views.map(view => view.id), [
    'travel.passport.status', 'travel.passport.overview', 'travel.passport.annual', 'travel.passport.regions',
  ]);
  assert.ok(manifest.ui.declarative.views.every(view => view.slot !== 'settings.section'
    || ['models', 'resources', 'workspace', 'capabilities', 'services', 'preferences'].includes(view.settings_destination)));
  assert.deepEqual(manifest.ui.declarative.views.flatMap(view => view.actions || []).map(action => action.action_ref), [
    'travel.passport.v1#runtime.setup', 'travel.passport.v1#annual.generate',
  ]);
  assert.equal(Object.hasOwn(manifest, 'content_lock'), false);
  assert.equal(existsSync(join(ROOT, 'app-contribution-adapter.json')), false);
  assert.equal(existsSync(join(ROOT, 'plugin.json')), false);
  assert.equal(existsSync(join(ROOT, '.codex-plugin/plugin.json')), false);
  assert.equal(existsSync(join(repoRoot, '.agents')), false);
  for (const rel of inventory.paths) {
    assert.equal(existsSync(join(ROOT, rel)), true, `missing canonical carrier file: ${rel}`);
    if (rel !== 'package.json') {
      assert.equal(existsSync(join(repoRoot, rel)), false, `duplicate root runtime file: ${rel}`);
    }
  }
});
