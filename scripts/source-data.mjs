import { mkdir, readFile, writeFile, rm, rename } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { csv, parseCsv } from './csv.mjs';
import { ROOT, readJson } from './data.mjs';
import { TABLES, UPDATE_DEFINITIONS } from './schema.mjs';

// The personal Obsidian vault is an adapter, not part of the data contract.
// A portable workspace can keep the same CSV/JSON source tables under any
// directory selected by dataSource.path in atlas-config.json.
export async function readAtlasConfig({ root = ROOT, path = process.env.TRAVEL_PASSPORT_CONFIG } = {}) {
  const configPath = resolve(root, path || 'data/atlas-config.json');
  const config = await readJson(configPath);
  return { ...config, configPath };
}

export async function resolveSource({ vault, source, config, root = ROOT } = {}) {
  if (source) return source;
  config ||= await readAtlasConfig({root});
  if (vault) {
    const base = resolve(vault);
    return { type: 'obsidian', base, folder: join(base, '50_🌍旅行记录', '53_整理说明'), files: config.obsidianFiles || {} };
  }
  const dataSource = config.dataSource;
  if (dataSource?.type === 'csv-directory' && dataSource.path) {
    const workspace=resolve(config.referenceRoot||root);
    const base = isAbsolute(dataSource.path) ? dataSource.path : resolve(workspace, dataSource.path);
    return { type: 'csv-directory', base: workspace, folder: resolve(base), path: resolve(base), files: dataSource.files || {} };
  }
  if (config.vault) {
    const base = resolve(config.vault);
    return { type: 'obsidian', base, folder: join(base, '50_🌍旅行记录', '53_整理说明'), files: config.obsidianFiles || {} };
  }
  throw new Error('未配置数据源：请在 data/atlas-config.json 设置 dataSource.path，或提供 vault');
}

const PORTABLE_FILES = Object.freeze({
  [TABLES.flightArchive]: 'flights.csv', [TABLES.ground]: 'movements.csv', [TABLES.places]: 'japan-places.csv',
  [TABLES.regionPlaces]: 'places.csv', [TABLES.journeys]: 'journeys.csv', [TABLES.visits]: 'visits.csv',
  [TABLES.visitCandidates]: 'visit-candidates.csv', [TABLES.cityPlaces]: 'city-places.csv',
  [TABLES.cityMoves]: 'city-moves.csv', [TABLES.cityJourneys]: 'city-journeys.json', [TABLES.cityEvidence]: 'city-evidence.json',
  ['全旅程数据点-定位证据.json']: 'global-evidence.json',
});
export function sourceFile(source, file) {
  if(source.type==='obsidian')return source.files?.[file]||file;
  if (source.type !== 'csv-directory') return file;
  const mapped = source.fileMap?.[file] || (!Array.isArray(source.files) && source.files?.[file]) || PORTABLE_FILES[file] || file;
  if (!mapped || isAbsolute(mapped) || mapped.split(/[\\/]/).includes('..')) throw new Error(`数据源文件路径无效：${file}`);
  return mapped;
}
export const sourcePath = (source, file) => join(source.folder, sourceFile(source, file));

const csvDefinitions = Object.freeze(Object.fromEntries(Object.entries(UPDATE_DEFINITIONS)
  .filter(([, def]) => def.file.endsWith('.csv'))));

function assertRows(key, rows) {
  const def = csvDefinitions[key];
  if (!def) throw new Error(`不可导入的源表：${key}`);
  if (!Array.isArray(rows)) throw new Error(`${key} 必须是数组`);
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`${key} 包含无效行`);
    const unknown = Object.keys(row).filter(field => !def.headers.includes(field));
    if (unknown.length) throw new Error(`${key} 含未登记字段：${unknown.join('、')}`);
    if (!String(row[def.id] ?? '').trim()) throw new Error(`${key} 缺少稳定编号字段 ${def.id}`);
  }
  const ids=rows.map(row=>String(row[def.id]));
  if(new Set(ids).size!==ids.length)throw new Error(`${key} 导入编号重复`);
}

async function readTable(folder, def) {
  try { return parseCsv(await readFile(join(folder, def.file), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && def.optional) return []; throw error; }
}

export async function initializeDataSource({ workspaceRoot = ROOT, sourceDir = 'data/source', coverage = [], writeConfig = false, configPath, replaceCoverage = false } = {}) {
  const root = resolve(workspaceRoot), folder = isAbsolute(sourceDir) ? sourceDir : resolve(root, sourceDir);
  const source={type:'csv-directory',base:root,folder,files:{...PORTABLE_FILES}};
  await mkdir(folder, { recursive: true });
  for (const def of Object.values(csvDefinitions)) {
    const path = sourcePath(source, def.file);
    try { await readFile(path); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await writeFile(path, csv([], def.headers)); }
  }
  for (const [file, value] of [[TABLES.cityJourneys, []], [TABLES.cityEvidence, {}], ['全旅程数据点-定位证据.json', {}]]) {
    const path = sourcePath(source, file);
    try { await readFile(path); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await writeFile(path, JSON.stringify(value, null, 2) + '\n'); }
  }
  if (writeConfig) {
    configPath = resolve(root, configPath || 'data/atlas-config.json');
    let config = {};
    try { config = JSON.parse(await readFile(configPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if(config.vault&&!config.dataSource)throw new Error('已有 Obsidian 工作区不能由初始化切换数据源；请用 --root 指定独立工作区');
    config.dataSource = { type: 'csv-directory', path: isAbsolute(sourceDir) ? folder : sourceDir, files: PORTABLE_FILES };
    config.referenceRoot ||= root;
    config.output ||= join(root, 'outputs');
    if (replaceCoverage || !Array.isArray(config.coverage)) config.coverage = coverage;
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  }
  return { ...source, fileMap: PORTABLE_FILES, files: Object.keys(PORTABLE_FILES), initializedFiles: Object.values(PORTABLE_FILES) };
}

// Import a complete portable bundle. Existing rows are never silently
// overwritten: a repeated id must have identical bytes, or the caller must
// explicitly use replace=true for a deliberate source replacement.
export async function importSourceBundle({ workspaceRoot = ROOT, sourceDir = 'data/source', bundle, replace = false, writeConfig = true, configPath } = {}) {
  if (!bundle || bundle.version !== 1) throw new Error('导入包必须声明 version:1');
  if(bundle.coverage!==undefined&&(!Array.isArray(bundle.coverage)||bundle.coverage.some(row=>!row||typeof row.name!=='string'||typeof row.flag!=='string')))throw new Error('coverage 必须是 {name,flag} 数组');
  const root=resolve(workspaceRoot),folder=isAbsolute(sourceDir)?sourceDir:resolve(root,sourceDir);
  const source={type:'csv-directory',base:root,folder,files:{...PORTABLE_FILES}};
  const changes=[];
  for (const [key, rows] of Object.entries(bundle)) {
    if (['version', 'coverage', 'cityJourneys', 'cityEvidence', 'globalEvidence'].includes(key)) continue;
    if (!csvDefinitions[key]) throw new Error(`导入包含未知数据层：${key}`);
    assertRows(key, rows);
    const def = csvDefinitions[key], path = sourcePath(source, def.file), existing = await readTable(source.folder, {...def,file:sourceFile(source,def.file),optional:true});
    const byId = new Map(existing.map(row => [row[def.id], row]));
    for (const row of rows) {
      const old = byId.get(row[def.id]);
      if (old && !replace && JSON.stringify(old) !== JSON.stringify({ ...Object.fromEntries(def.headers.map(h => [h, ''])), ...row }))
        throw new Error(`${key} 编号已存在且内容不同：${row[def.id]}；请先审阅或使用 replace=true`);
      byId.set(row[def.id], { ...Object.fromEntries(def.headers.map(h => [h, ''])), ...row });
    }
    changes.push({path,next:csv([...byId.values()], def.headers)});
  }
  for(const [key,file]of [['cityJourneys',TABLES.cityJourneys],['cityEvidence',TABLES.cityEvidence],['globalEvidence','全旅程数据点-定位证据.json']]){
    if(bundle[key]===undefined)continue;
    if(key==='cityJourneys'?!Array.isArray(bundle[key]):!bundle[key]||typeof bundle[key]!=='object'||Array.isArray(bundle[key]))throw new Error(`${key} 数据类型无效`);
    changes.push({path:sourcePath(source,file),next:JSON.stringify(bundle[key],null,2)+'\n'});
  }
  const initialized=await initializeDataSource({ workspaceRoot, sourceDir, writeConfig:false, configPath, coverage: bundle.coverage || [] });
  // Every declared table is validated before the first source write. Stage all
  // new bytes before replacing files, preserving existing data on invalid input.
  const staged=[];
  try{
    for(const change of changes){const temp=change.path+'.'+process.pid+'.import';await writeFile(temp,change.next);staged.push({...change,temp});}
    for(const change of staged)await rename(change.temp,change.path);
  }finally{for(const change of staged)await rm(change.temp,{force:true});}
  if(writeConfig)await initializeDataSource({workspaceRoot,sourceDir,writeConfig:true,configPath,coverage:bundle.coverage||[],replaceCoverage:bundle.coverage!==undefined});
  return { ...initialized, imported: Object.keys(bundle).filter(key => key !== 'version' && key !== 'coverage') };
}
