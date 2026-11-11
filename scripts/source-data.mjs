import { lstatSync, realpathSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { csv, parseCsv } from './csv.mjs';
import { WORKSPACE_ROOT, readJson } from './data.mjs';
import { TABLES, UPDATE_DEFINITIONS } from './schema.mjs';

// The personal Obsidian vault is an adapter, not part of the data contract.
// A portable workspace can keep the same CSV/JSON source tables under any
// directory selected by dataSource.path in atlas-config.json.
export async function readAtlasConfig({ root = WORKSPACE_ROOT, path = process.env.TRAVEL_PASSPORT_CONFIG } = {}) {
  const configPath = resolve(root, path || 'data/atlas-config.json');
  const config = await readJson(configPath).catch(error => {
    if (error.code !== 'ENOENT' || path) throw error;
    return { dataSource: { type: 'csv-directory', path: 'data/source' }, output: join(root, 'outputs'), coverage: [] };
  });
  return { ...config, ...(config.output ? { output: resolve(root, config.output) } : {}), configPath };
}

function relativeName(name) {
  if(typeof name!=='string'||!name.trim()||isAbsolute(name)||/^[A-Za-z]:/.test(name)||name.includes('\\')||name.split('/').includes('..'))throw new Error(`来源相对路径无效：${name}`);
  return name;
}
function within(base,target){const rel=relative(base,target);return rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);}
function physicalPath(path){
  try{return realpathSync(path);}
  catch(error){if(error.code!=='ENOENT')throw error;try{if(lstatSync(path).isSymbolicLink())throw new Error('来源路径不能使用失效符号链接：'+path);}catch(check){if(check.code!=='ENOENT')throw check;}const parent=dirname(path);if(parent===path)throw error;return join(physicalPath(parent),relative(parent,path));}
}
// Optional files may not exist; validate their real parent too, so symlinks
// cannot redirect reads, writes, rollback or receipt inspection outside the root.
export function boundedSourcePath(base,name){
  relativeName(name);const lexicalBase=resolve(base),target=resolve(base,name),physicalBase=physicalPath(lexicalBase),physicalTarget=physicalPath(target);
  if(!within(physicalBase,physicalTarget))throw new Error('来源路径不能越出配置根目录：'+name);
  return target;
}
export async function resolveSource({vault,source,config,root=WORKSPACE_ROOT}={}){
  if(source)return source;
  config ||= await readAtlasConfig({root});
  const selected=config.dataSource;
  if(selected&&!['csv-directory','obsidian'].includes(selected.type))throw new Error('未知 dataSource.type');
  let type,base,folder,files,referenceRoots;
  if(vault||!selected&&config.vault||selected?.type==='obsidian'){
    type='obsidian';base=resolve(vault||selected?.path||config.vault);
    const layout=selected?.type==='obsidian'?selected:{};
    folder=boundedSourcePath(base,layout.tableDirectory||'50_🌍旅行记录/53_整理说明');
    files=layout.files||config.obsidianFiles||{};referenceRoots=layout.referenceRoots||['50_🌍旅行记录'];
  }else if(selected?.type==='csv-directory'&&selected.path){
    type='csv-directory';base=resolve(root,config.referenceRoot||root);
    folder=resolve(base,selected.path);physicalPath(folder);files=selected.files||{};referenceRoots=selected.referenceRoots||['.'];
  }else throw new Error('未配置数据源：请设置 dataSource.path，或提供 vault');
  if(!files||typeof files!=='object'||Array.isArray(files))throw new Error('来源 files 必须是文件映射');
  for(const name of Object.values(files))relativeName(name);
  if(!Array.isArray(referenceRoots)||!referenceRoots.length)throw new Error('referenceRoots 必须声明允许的正文相对目录');
  const referencePaths=referenceRoots.map(name=>boundedSourcePath(base,name));
  // Inventory only the source and declared reference areas. An implicit portable
  // '.' reference fallback must not expand storage scans to the entire workspace.
  const roots=[...new Set([folder,...(type==='obsidian'||selected?.referenceRoots?referencePaths:[])].map(physicalPath))];
  const storageRoots=roots.filter(path=>!roots.some(other=>other!==path&&within(other,path)));
  const result={type,base,folder,path:folder,files,referenceRoots,storageRoots};
  assertDistinctSourceFiles(result,[...Object.values(TABLES),'全旅程数据点-定位证据.json']);
  return result;
}

const PORTABLE_FILES = Object.freeze({
  [TABLES.flightArchive]: 'flights.csv', [TABLES.ground]: 'movements.csv', [TABLES.places]: 'japan-places.csv',
  [TABLES.regionPlaces]: 'places.csv', [TABLES.journeys]: 'journeys.csv', [TABLES.visits]: 'visits.csv',
  [TABLES.visitCandidates]: 'visit-candidates.csv', [TABLES.cityPlaces]: 'city-places.csv',
  [TABLES.cityMoves]: 'city-moves.csv', [TABLES.cityJourneys]: 'city-journeys.json', [TABLES.cityEvidence]: 'city-evidence.json',
  ['全旅程数据点-定位证据.json']: 'global-evidence.json',
});
export function sourceFile(source,file){
  return relativeName(source.fileMap?.[file]||(!Array.isArray(source.files)&&source.files?.[file])||(source.type==='csv-directory'?PORTABLE_FILES[file]:null)||file);
}
export const sourcePath=(source,file)=>boundedSourcePath(source.folder,sourceFile(source,file));
export function sourceReferencePath(source,link){
  const target=boundedSourcePath(source.base,link),physicalTarget=physicalPath(target),allowed=source.referenceRoots||(source.type==='obsidian'?['50_🌍旅行记录']:['.']);
  if(!allowed.some(name=>within(physicalPath(boundedSourcePath(source.base,name)),physicalTarget)))throw new Error('正文回链须位于允许的来源目录：'+link);
  return target;
}

export function assertDistinctSourceFiles(source,names){
  const paths=new Map();
  for(const file of new Set(names)){const target=physicalPath(sourcePath(source,file));if(paths.has(target))throw new Error('源表不能映射到同一文件：'+paths.get(target)+' / '+file);paths.set(target,file);}
}


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

export async function initializeDataSource({ workspaceRoot = WORKSPACE_ROOT, sourceDir = 'data/source', coverage = [], writeConfig = false, configPath, replaceCoverage = false } = {}) {
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
export async function importSourceBundle({ workspaceRoot = WORKSPACE_ROOT, sourceDir = 'data/source', bundle, replace = false, writeConfig = true, configPath } = {}) {
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
