import {readAtlasConfig} from './source-data.mjs';
import {spawn} from 'node:child_process';
import {stat,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readJson,ROOT} from './data.mjs';
import {loadAtlas} from './atlas-data.mjs';
import {compareManifest,manifestPath} from './manifest.mjs';

// One review command for the complete read-only acceptance loop. It deliberately
// does not rebuild or modify the maintenance source; use `npm run build` when
// source changes need to be materialized first.
const config=await readAtlasConfig();
const scratch=await mkdtemp(join(tmpdir(),'travel-verify-'));
const checks=[
  ['syntax', ['run','check']],
  ['data', ['run','check:data']],
  ['storage', ['run','storage']],
  ['continuity', ['run','audit:continuity','--','--output',join(scratch,'continuity')]],
  ['gateways', ['run','audit:gateways','--','--output',join(scratch,'gateways')]],
  ['site', ['run','site:test','--','--output',join(config.output,'site'),'--checks',join(scratch,'site')]],
];

const run=(label,args)=>new Promise((resolve,reject)=>{
  const child=spawn(process.platform==='win32'?'npm.cmd':'npm',['--silent',...args],{stdio:'inherit'});
  child.on('error',reject);
  child.on('exit',(code,signal)=>code===0?resolve():reject(new Error(`${label} 检查失败${signal?`（${signal}）`:''}`)));
});

// A green audit against a stale site is not a deliverable.  Check the same
// manifest used by `passport status` after the source audit and before the
// browser pass, so a forgotten rebuild fails fast and says exactly what must
// be regenerated.
const checkFresh=async()=>{
  const {folder,source}=await loadAtlas();
  const config=await readAtlasConfig();
  const freshness=await compareManifest(manifestPath(config.output),folder,ROOT,undefined,source);
  const manifest=freshness.manifest;
  const listed=[...(manifest?.outputs||[]),...(manifest?.render?.images||[]),
    ...(manifest?.cityExport?.images||[]),...(manifest?.flightExport?.images||[]),
    ...(manifest?.annualExport?.images||[]),...(manifest?.annualExport?.summaries||[]),
    'site/index.html'];
  const missing=[];
  for(const relative of [...new Set(listed)]){
    try{await stat(join(config.output,relative));}catch(e){if(e.code==='ENOENT')missing.push(relative);else throw e;}
  }
  console.log(JSON.stringify({state:freshness.state,changed:freshness.changed,missing},null,2));
  if(freshness.state!=='fresh'||missing.length){
    const changed=freshness.changed.length?`：${freshness.changed.join('、')}`:'';
    const absent=missing.length?`；缺少交付文件：${missing.join('、')}`:'';
    throw new Error(`构建产物不是最新${changed}${absent}；先运行 npm run build`);
  }
};

try{
  for(const [label,args] of checks.slice(0,2)){
    console.log(`\n[verify] ${label}`);
    await run(label,args);
  }
  console.log('\n[verify] freshness');
  await checkFresh();
  for(const [label,args] of checks.slice(2)){
    console.log(`\n[verify] ${label}`);
    await run(label,args);
  }
  console.log('\n[verify] 全部检查通过');
}catch(error){
  console.error(`\n[verify] ${error.message}`);
  console.error('本次诊断保留于：'+scratch);
  process.exitCode=1;
}finally{
  if(!process.exitCode)await rm(scratch,{recursive:true,force:true});
}
