// Rebuildable public maps and browser diagnostics. This command accepts no
// arbitrary path: personal evidence, source tables and generated outputs can
// never be swept by a mistyped glob.
import {readdir, rm, lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT} from './data.mjs';

export const CACHE_KINDS=Object.freeze({
  'public-geography':'Natural Earth 原始下载；由 fetch-geography.mjs 或 fetch-city-geography.mjs 重建',
  'public-tiles':'OpenFreeMap / OSM / GSI 公共地图瓦片；由 fetch-city-geography.mjs 重建',
  'browser-checks':'最近一次独立浏览器检查的截图与诊断；由 site:test 重建',
  'visit-evidence':'地点证据预筛报告；由 audit-visit-evidence.mjs 重建，不含正式核定',
});

async function sizeOf(path){
  let total=0;
  for(const entry of await readdir(path,{withFileTypes:true})){
    const child=join(path,entry.name);
    total+=entry.isDirectory()?await sizeOf(child):(await lstat(child)).size;
  }
  return total;
}

export async function pruneCache({root=ROOT,kinds=Object.keys(CACHE_KINDS),apply=true}={}){
  const requested=[...new Set(kinds)];
  const unknown=requested.filter(kind=>!Object.hasOwn(CACHE_KINDS,kind));
  if(unknown.length)throw new Error('只允许清理已知可重建缓存：'+unknown.join('、'));
  const entries=[];
  const cacheRoot=join(root,'data/site-cache');
  for(const kind of requested){
    const path=['browser-checks','visit-evidence'].includes(kind)?join(root,'private/runtime',kind):join(cacheRoot,kind);
    try{
      const info=await lstat(path);
      if(!info.isDirectory())throw new Error('缓存路径不是目录：'+path);
      entries.push({kind,path,bytes:await sizeOf(path)});
    }catch(e){
      if(e.code!=='ENOENT')throw e;
    }
  }
  if(apply)for(const entry of entries)await rm(entry.path,{recursive:true,force:true});
  return {apply,kinds:requested,entries,removedBytes:entries.reduce((sum,e)=>sum+e.bytes,0)};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const dryRun=process.argv.includes('--dry-run');
  const kindArg=process.argv.find(arg=>arg.startsWith('--kind='));
  const kinds=kindArg?kindArg.slice('--kind='.length).split(',').filter(Boolean):Object.keys(CACHE_KINDS);
  const report=await pruneCache({kinds,apply:!dryRun});
  console.log(JSON.stringify({dryRun,...report},null,2));
}
