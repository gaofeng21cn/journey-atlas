#!/usr/bin/env node
/*
 * Build redistributable administrative layers from Natural Earth context.
 * This intentionally writes to an explicit output directory and never copies
 * the private city, GPS, or Obsidian resources used by the personal build.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { ROOT, readJson } from './data.mjs';

const clean = value => String(value || '').trim().toLowerCase()
  .replace(/(?:特别行政区|壮族自治区|维吾尔自治区|回族自治区|自治区|省|县|州|府|都|県|市)$/, '')
  .replace(/[·\s]/g, '');
const coordinate = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);

function ringsOf(geometry) {
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function toTopology(features, objectName, { propertyId = 'id' } = {}) {
  const arcs = [];
  const geometries = features.map(feature => {
    const rings = ringsOf(feature.geometry);
    const refs = rings.map(polygon => polygon.map(ring => {
      if (!ring.every(coordinate)) throw new Error(`无效边界坐标：${feature.id}`);
      const index = arcs.length;
      // A raw, untransformed TopoJSON arc is valid and keeps the generator
      // dependency-free. Each ring is independent so no topology is lost.
      arcs.push(ring);
      return [index];
    }));
    const type = feature.geometry.type;
    return { type, id: feature[propertyId] ?? feature.id, properties: feature.properties || {}, arcs: type === 'Polygon' ? refs[0] : refs };
  });
  return { type: 'Topology', attribution:'Natural Earth · Public Domain', objects: { [objectName]: { type: 'GeometryCollection', geometries } }, arcs };
}

function indexByName(features) {
  const index = new Map();
  for (const feature of features) {
    const name = clean(feature.properties?.name);
    if (name && !index.has(name)) index.set(name, feature);
  }
  return index;
}

function selectUnits(units, contextFeatures, prefix, { idField = 'id', aliases = {}, extra = new Map() } = {}) {
  const index = indexByName(contextFeatures);
  const missing = [], selected = [];
  for (const unit of units) {
    const feature = index.get(clean(aliases[unit.id])) || index.get(clean(unit.name)) || index.get(clean(unit.native)) || extra.get(unit.id);
    if (!feature) { missing.push(unit); continue; }
    const id = `${prefix}${unit[idField] || unit.id}`.replace(/^CN-CN-/, 'CN-').replace(/^CH-CH-/, 'CH-');
    selected.push({
      ...feature,
      id,
      properties: { ...feature.properties, name: unit.name, native: unit.native || feature.properties.name, english: unit.native || unit.name, unitId: id,
        ...(prefix==='JP-'?{id:Number(unit.id),nam_ja:unit.native}: {}) },
    });
  }
  return { selected, missing };
}

async function main() {
  const { values } = parseArgs({ options: {
    output: { type: 'string', default: join(ROOT, 'data/open-geography') },
    check: { type: 'boolean', default: false },
  } });
  const [context, prefectures, catalog] = await Promise.all([
    readJson(join(ROOT, 'data/geographic-context.json')),
    readJson(join(ROOT, 'data/japan-prefectures.json')),
    readJson(join(ROOT, 'data/region-catalog.json')),
  ]);
  const regions = context.layers.regions.features;
  const report = { source: 'Natural Earth · Public Domain', output: resolve(values.output), layers: {}, missing: {} };
  const japanUnits = prefectures.map(([code, name, native]) => ({ id: code, name: name.replace(/[都府县]$/, ''), native }));
  const japan = selectUnits(japanUnits, regions.filter(f => f.properties.code === 'JP'), 'JP-', { idField: 'id' });
  report.layers.japan = japan.selected.length; report.missing.japan = japan.missing.map(u => u.name);
  const switzerland = selectUnits(catalog.switzerland.units, regions.filter(f => f.properties.code === 'CH'), 'CH-', { idField: 'native', aliases: {
    'CH-BE':'伯恩州', 'CH-GL':'格拉魯斯州', 'CH-BS':'巴塞尔城市州', 'CH-GE':'日內瓦州',
  } });
  report.layers.switzerland = switzerland.selected.length; report.missing.switzerland = switzerland.missing.map(u => u.name);
  const countryFeatures = context.layers.countries.features;
  const extra = new Map([['CN-71','TW'],['CN-81','HK'],['CN-82','MO']].map(([id, code])=>[id,countryFeatures.find(f=>f.properties.code===code)]));
  const china = selectUnits(catalog.china.units, regions.filter(f => f.properties.code === 'CN'), 'CN-', { idField: 'id', extra });
  report.layers.china = china.selected.length; report.missing.china = china.missing.map(u => u.name);
  if (values.check) {
    report.ok = !Object.values(report.missing).some(items => items.length);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (!report.ok) process.exitCode = 2;
    return;
  }
  if (Object.values(report.missing).some(items => items.length)) {
    throw new Error(`公开地理层存在未映射行政区：${JSON.stringify(report.missing)}`);
  }
  await mkdir(report.output, { recursive: true });
  await Promise.all([
    writeFile(join(report.output, 'japan.topojson'), JSON.stringify(toTopology(japan.selected, 'japan', { propertyId: 'id' })) + '\n'),
    writeFile(join(report.output, 'swiss-cantons.topojson'), JSON.stringify(toTopology(switzerland.selected, 'cantons')) + '\n'),
    writeFile(join(report.output, 'switzerland.geojson'), JSON.stringify({ type: 'FeatureCollection', attribution: report.source, license: 'Public Domain', features: switzerland.selected }) + '\n'),
    writeFile(join(report.output, 'china.geojson'), JSON.stringify({ type: 'FeatureCollection', attribution: report.source, license: 'Public Domain', features: china.selected }) + '\n'),
    writeFile(join(report.output, 'open-geography-report.json'), JSON.stringify({ ...report, generatedAt: new Date().toISOString() }, null, 2) + '\n'),
  ]);
  process.stdout.write(JSON.stringify({ ...report, written: ['japan.topojson', 'swiss-cantons.topojson', 'switzerland.geojson', 'china.geojson'] }, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });

export { clean, toTopology, selectUnits };
