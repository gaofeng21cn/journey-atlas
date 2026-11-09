import {lstat,readdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {ROOT,readJson} from './data.mjs';
import {resolveSource,readAtlasConfig} from './source-data.mjs';

// Read-only physical inventory. Nested areas are shown separately, never
// summed as if they were independent copies. Symlink targets are not scanned.
async function measure(value){
  const paths=Array.isArray(value)?value:[value];
  const seen=new Set(),result={path:paths.length===1?paths[0]:null,paths,files:0,logicalBytes:0,allocatedBytes:0};
  async function walk(name){
    const s=await lstat(name).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    if(!s||s.isSymbolicLink())return;
    const key=s.dev+':'+s.ino;if(seen.has(key))return;seen.add(key);
    result.allocatedBytes+=(s.blocks||0)*512;
    if(s.isDirectory())for(const entry of await readdir(name))await walk(join(name,entry));
    else if(s.isFile()){result.files++;result.logicalBytes+=s.size;}
  }
  for(const path of paths)await walk(path);return result;
}
const config=await readAtlasConfig(),source=await resolveSource({config});
const areas={app:ROOT,vault:source.storageRoots,output:config.output||join(ROOT,'outputs'),
  history:join(ROOT,'private/history'),runtime:join(ROOT,'private/runtime'),rollback:join(ROOT,'data/history')};
try{areas.sourceWorkbench=dirname((await readJson(join(ROOT,'inputs/global-sources.json'))).photosPath);}catch(e){if(e.code!=='ENOENT')throw e;}
const usage=Object.fromEntries(await Promise.all(Object.entries(areas).map(async([key,path])=>[key,await measure(path)])));
const budgets={history:256*1024*1024,runtime:64*1024*1024};
const overBudget=Object.entries(budgets).filter(([key,limit])=>usage[key].allocatedBytes>limit)
  .map(([area,limit])=>({area,limitBytes:limit,allocatedBytes:usage[area].allocatedBytes,action:area==='runtime'?'清理已登记可重建缓存':'先复核历史职责与重复内容，再决定退出；不自动删除证据'}));
console.log(JSON.stringify({state:overBudget.length?'review-required':'within-budget',usage,budgets,overBudget,
  sourceInventory:'vault 为源表与已声明正文目录的去重统计；旧 Vault 默认覆盖整个旅行区；不跟随目录内符号链接',
  policy:'当前输出覆盖更新；浏览器诊断只保留最近一批；自动回滚最近12份；历史只压缩退出的唯一内容，不随构建新增全量副本'},null,2));
if(overBudget.length)process.exitCode=1;
