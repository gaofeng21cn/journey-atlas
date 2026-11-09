import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { SCHEMA_VERSION, TABLES, OPTIONAL_SOURCE_FILES } from './schema.mjs';
import {ROOT} from './data.mjs';
import {parseCsv} from './csv.mjs';
import {referencedEvidenceFiles} from './source-references.mjs';
import {sourcePath,readAtlasConfig} from './source-data.mjs';

export const MANIFEST = '旅行护照构建清单.json';

// These are the human-maintained files that determine every derived table and
// image. The manifest deliberately stores only relative names and hashes, so a
// copied output never leaks a local vault path.
export const SOURCE_FILES = Object.freeze([
  TABLES.flightArchive,
  TABLES.ground,
  TABLES.places,
  TABLES.regionPlaces,
  TABLES.journeys,
  TABLES.visitCandidates,
]);

const PUBLIC_DATA_FILES = Object.freeze([
  'data/atlas-config.json',
  'data/region-catalog.json','data/japan-prefectures.json','data/china.geojson',
  'data/europe-countries.topojson','data/europe.geojson','data/greece-regions.geojson',
  'data/greece.geojson','data/italy-regions.geojson','data/italy.geojson',
  'data/japan.topojson','data/southeast-asia.geojson',
  'data/swiss-cantons.topojson','data/switzerland.geojson','data/usa.geojson',
  'data/us-states.topojson',
  'data/city-catalog.json',
  'data/geographic-context.json',
  'data/scope-hierarchy.json',
]);

async function fileInfo(folder, name, path = join(folder,name)) {
  const [bytes, fileStat] = await Promise.all([readFile(path), stat(path)]);
  return {
    file: name,
    bytes: bytes.byteLength,
    mtimeMs: Math.round(fileStat.mtimeMs),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export async function sourceManifest(folder, names = SOURCE_FILES, root=ROOT, source={type:'obsidian',folder}) {
  const required=await Promise.all(names.map(async name => ({...await fileInfo(folder,name,sourcePath(source,name)), file: `vault/${name}`})));
  for(const name of [...OPTIONAL_SOURCE_FILES,TABLES.visits,'全旅程数据点-定位证据.json']){try{required.push({...await fileInfo(folder,name,sourcePath(source,name)),file:`vault/${name}`});}catch(e){if(e.code!=='ENOENT')throw e;}}
  const rows=(await Promise.all(required.filter(item=>item.file.endsWith('.csv')).map(item=>readFile(sourcePath(source,item.file.slice('vault/'.length)),'utf8').then(parseCsv)))).flat();
  for(const name of referencedEvidenceFiles(rows,{root}))required.push({...await fileInfo(root,name),file:`app/${name}`});
  return required;
}

async function codeFiles(root) {
  const out=[];
  for (const folder of ['scripts','src']) {
    const entries=await readdir(join(root,folder),{withFileTypes:true});
    for (const entry of entries) if(entry.isFile()&&/\.(mjs|js|css|html|py|txt)$/.test(entry.name)) out.push(join(folder,entry.name));
  }
  const cities=JSON.parse(await readFile(join(root,'data/city-catalog.json'),'utf8'));
  const cityResources=cities.flatMap(c=>['data/'+c.boundaryFile,'data/'+c.contextFile,...(c.landMaskFile?['data/'+c.landMaskFile]:[])]);
  for(const name of cityResources){try{await stat(join(root,name));out.push(name);}catch(error){if(error.code!=='ENOENT')throw error;}}
  return [...new Set([...out,'package.json','package-lock.json',...PUBLIC_DATA_FILES])];
}

export async function runtimeManifest(root) {
  const names=await codeFiles(root);
  try{await stat(join(root,'data/profile.json'));names.push('data/profile.json');}catch(e){if(e.code!=='ENOENT')throw e;}
  // Display identity lookup is optional, but a change to it must invalidate
  // maps just like a change to the public city catalogue.
  try{await stat(join(root,'data/geocode-cache.json'));names.push('data/geocode-cache.json');}catch(e){if(e.code!=='ENOENT')throw e;}
  try{await stat(join(root,'data/annual-config.json'));names.push('data/annual-config.json');}catch(e){if(e.code!=='ENOENT')throw e;}
  return Promise.all(names.map(async name => ({...await fileInfo(root,name,name==='data/atlas-config.json'?(await readAtlasConfig({root})).configPath:join(root,name)),file:`app/${name}`})));
}

export function manifestFrom({ sources, atlas, outputFiles = [] }) {
  return {
    version: 1,
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    sources,
    derived: {
      places: atlas.locationLayer?.summary?.records ?? 0,
      connectedPlaces: atlas.locationLayer?.summary?.connected ?? 0,
      routes: atlas.routes?.length ?? 0,
      trajectoryLegs: atlas.trajectorySummary?.legs ?? 0,
      trajectoryBreaks: atlas.trajectorySummary?.breaks ?? 0,
      pendingConnections: atlas.trajectorySummary?.pendingConnectors ?? 0,
      visitInstances: atlas.visitInstanceSummary,
      totalKm: atlas.meta?.totalKm ?? 0,
      countries: atlas.meta?.countries ?? 0,
      regions: Object.keys(atlas.regions || {}),
    },
    outputs: outputFiles,
  };
}

export async function compareManifest(path, folder, root, names = SOURCE_FILES, source) {
  let saved;
  try {
    saved = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return { state: 'missing', changed: names, manifest: null };
  }
  const current = [...await sourceManifest(folder, names,root||ROOT,source), ...(root ? await runtimeManifest(root) : [])];
  const old = new Map((saved.sources || []).map(item => [item.file, item.sha256]));
  const changed = current.filter(item => old.get(item.file) !== item.sha256).map(item => item.file);
  const removed = [...old.keys()].filter(file => !current.some(item => item.file === file));
  return {
    state: changed.length || removed.length ? 'stale' : 'fresh',
    changed: [...changed, ...removed],
    manifest: saved,
    current,
  };
}

export async function annotateManifest(path, patch) {
  let manifest;
  try { manifest = JSON.parse(await readFile(path, 'utf8')); }
  catch { return null; }
  const next = {...manifest, ...patch};
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, JSON.stringify(next, null, 2) + '\n');
  return next;
}

export function manifestPath(output) {
  return join(output, 'checks', MANIFEST);
}

export function relativeSourcePath(folder, path) {
  return relative(folder, path);
}
