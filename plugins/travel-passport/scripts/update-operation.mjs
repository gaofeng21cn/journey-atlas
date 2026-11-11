import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,rename,unlink} from 'node:fs/promises';
import {dirname,join,relative,resolve} from 'node:path';
import {sourcePath,boundedSourcePath,assertDistinctSourceFiles} from './source-data.mjs';
import {WORKSPACE_ROOT} from './data.mjs';
import {TABLES,UPDATE_DEFINITIONS} from './schema.mjs';
import {sourceFile} from './source-data.mjs';
import {maintainHistory} from './prune-history.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const read=path=>readFile(path).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
const hash=bytes=>bytes===null?null:digest(bytes);
const errorWith=(code,message)=>Object.assign(new Error(message),{code});
const receiptPath=(id,root=WORKSPACE_ROOT)=>{
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(id||''))throw errorWith('INVALID_OPERATION_ID','更新 operation ID 无效');
  return join(root,'private/evidence/updates',id+'.json');
};
const sourceNames=[...new Set([...Object.values(UPDATE_DEFINITIONS).map(d=>d.file),TABLES.cityJourneys,TABLES.cityEvidence,TABLES.visitCandidates,'全旅程数据点-定位证据.json'])].sort();

// This revision covers the maintained tables, not generated map files.
export async function updateSourceSnapshot(folder,source={type:'obsidian',folder}){
  assertDistinctSourceFiles(source,sourceNames);
  const files=await Promise.all(sourceNames.map(async file=>({file,sha256:hash(await read(sourcePath(source,file)))})));
  return {revision:digest(JSON.stringify(files)),files};
}
export function requireSourceRevision(snapshot,expected){
  if(expected&&snapshot.revision!==expected)throw errorWith('STALE_SOURCE','维护源版本已变化，请重新预览更新');
}
async function saveReceipt(receipt,path){
  const temporary=path+'.'+process.pid+'.tmp';
  try{await writeFile(temporary,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});await rename(temporary,path);}
  finally{await unlink(temporary).catch(()=>{});}
}

export async function inspectUpdate(id,{root=WORKSPACE_ROOT}={}){
  const path=receiptPath(id,root);
  const receipt=JSON.parse(await readFile(path,'utf8'));
  const files=await Promise.all(receipt.files.map(async item=>({...item,current:hash(await read(boundedSourcePath(receipt.sourceFolder,item.sourcePath||item.file)))})));
  const allBefore=files.every(f=>f.current===f.before),allAfter=files.every(f=>f.current===f.after);
  const sourceState=allAfter?'matches_applied':allBefore?'matches_before':'diverged';
  return {...receipt,receipt:path,readback:{sourceState,files},
    // Interrupted operations require inspection, never an automatic write retry.
    nextAction:sourceState==='diverged'?'reconcile':receipt.state==='completed'?'none':receipt.state==='applied_build_failed'?'build':
      receipt.state==='source_applied'?'inspect_build':receipt.state==='failed'?'review_error':'reconcile'};
}

export async function applySourceUpdate({folder,source={type:'obsidian',folder},snapshot,changes,report,dryRun=false,operationId=randomUUID(),kind='atlas',root=WORKSPACE_ROOT}){
  folder=boundedSourcePath(folder,'.');
  const current=await updateSourceSnapshot(folder,source);requireSourceRevision(current,snapshot.revision);
  const files=changes.map(t=>({file:t.file,sourcePath:relative(resolve(source.folder),sourcePath(source,t.file)),before:hash(t.original===null?null:Buffer.from(t.original)),after:digest(t.next)}));
  const sourceMeta={before:snapshot.revision,after:digest(JSON.stringify(snapshot.files.map(f=>({file:f.file,sha256:files.find(c=>c.file===f.file)?.after??f.sha256}))))};
  if(dryRun)return {...report,schemaVersion:'travel-passport.update.v1',ok:true,state:'preview',source:sourceMeta,changedFiles:files.map(f=>f.file),operationId:null,receipt:null};
  const path=receiptPath(operationId,root),startedAt=new Date().toISOString();
  await mkdir(join(root,'private/evidence/updates'),{recursive:true});
  const backup=changes.length?join(root,'data/history',startedAt.replace(/[:.]/g,'-')+'-'+kind):null;
  let receipt={...report,schemaVersion:'travel-passport.update.v1',ok:true,state:'applying',operationId,startedAt,sourceFolder:resolve(folder),source:sourceMeta,files,backup,receipt:path,build:{state:'pending'}};
  try{await writeFile(path,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});}
  catch(error){if(error.code==='EEXIST')throw Object.assign(errorWith('OPERATION_EXISTS','该 operation 已登记，请使用 receipt --id 回读，不能重放'),{operationId,receipt:path});throw error;}
  const written=[],temporary=[];
  try{
    if(backup)await mkdir(backup,{recursive:true});
    for(const t of changes){
      if(hash(await read(sourcePath(source,t.file)))!==files.find(f=>f.file===t.file).before)throw errorWith('STALE_SOURCE','源表并发修改，停止更新：'+t.file);
      if(t.original!==null){const saved=join(backup,t.file);await mkdir(dirname(saved),{recursive:true});await writeFile(saved,t.original);}
    }
    for(const t of changes){
      const target=sourcePath(source,t.file),temp=target+'.'+process.pid+'.tmp';temporary.push(temp);
      await mkdir(dirname(target),{recursive:true});
      await writeFile(temp,t.next);
      if(hash(await read(target))!==files.find(f=>f.file===t.file).before)throw errorWith('STALE_SOURCE','源表并发修改，停止更新：'+t.file);
      await rename(temp,target);written.push(t);
    }
    receipt={...receipt,state:'source_applied',sourceAppliedAt:new Date().toISOString()};
    await saveReceipt(receipt,path);
    if(backup)await writeFile(join(backup,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  }catch(error){
    // Only restore this operation's bytes; a later writer retains ownership.
    const rollbackErrors=[];
    for(const t of written)try{
      const target=sourcePath(source,t.file);
      if(hash(await read(target))===digest(t.next)){if(t.original===null)await unlink(target);else await writeFile(target,t.original);}
    }catch(rollbackError){rollbackErrors.push(rollbackError.message);}
    receipt={...receipt,ok:false,state:'outcome_unknown',error:{code:error.code||'UPDATE_FAILED',message:error.message},rollbackErrors,build:{state:'not_started'}};
    try{
      await saveReceipt(receipt,path);
      const observed=await inspectUpdate(operationId,{root});
      receipt={...receipt,state:observed.readback.sourceState==='matches_before'?'failed':'outcome_unknown'};
      await saveReceipt(receipt,path);
    }catch(receiptError){receipt.receiptError=receiptError.message;}
    throw Object.assign(error,{updateResult:receipt});
  }finally{for(const p of temporary)await unlink(p).catch(()=>{});}
  if(root===WORKSPACE_ROOT)await maintainHistory();
  return receipt;
}

export async function finishUpdate(report,{error,artifacts=[]}={}){
  const result={...report,ok:!error,state:error?'applied_build_failed':'completed',finishedAt:new Date().toISOString(),
    build:error?{state:'failed',error:error.message,nextAction:'build'}:{state:'completed',artifacts}};
  try{await saveReceipt(result,report.receipt);}
  catch(error){throw Object.assign(error,{updateResult:{...result,ok:false,error:{code:'RECEIPT_WRITE_FAILED',message:error.message}}});}
  return result;
}
export function updateErrorResult(error){
  return error.updateResult||{schemaVersion:'travel-passport.update.v1',ok:false,state:'rejected',
    operationId:error.operationId||null,receipt:error.receipt||null,error:{code:error.code||'INVALID_UPDATE',message:error.message}};
}
