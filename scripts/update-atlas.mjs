import { readFile } from 'node:fs/promises';
import {createHash} from 'node:crypto';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { ROOT,readJson } from './data.mjs';
import { parseCsv,csv,loadAtlas,refreshAtlas } from './atlas-data.mjs';
import { REGION_PLACES } from './region-data.mjs';
import { renderAtlas } from './render-atlas.mjs';
import { UPDATE_DEFINITIONS } from './schema.mjs';
import {validateContinuityDelta} from './continuity-audit.mjs';
import {loadCityDetails} from './city-data.mjs';
import {validatePlaceEvidence,validateMovementEvidence,EVIDENCE_HEADERS} from './evidence-contract.mjs';
import {archiveBoundaryRows,mergeReviewedVisitRows} from './visit-instances.mjs';
import {updateSourceSnapshot,requireSourceRevision,applySourceUpdate,finishUpdate,updateErrorResult} from './update-operation.mjs';
import {manifestPath} from './manifest.mjs';
import {validateLinks} from './source-references.mjs';
import {resolveSource,sourcePath,readAtlasConfig} from './source-data.mjs';

// One schema owns the patchable columns for all source tables. The region table
// name is supplied by region-data for compatibility with older private layouts.
const definitions={...UPDATE_DEFINITIONS,regionPlaces:{...UPDATE_DEFINITIONS.regionPlaces,file:REGION_PLACES}};

// A migration can carry an existing decision forward, never manufacture a new
// review. Changed factual fields and promoted/new rows require a fresh record.
export function validateEvidenceDelta(before,after,key,{migration=false}={}){
  const def=definitions[key];if(!def)return;
  const isPlace=['japanPlaces','regionPlaces','cityPlaces'].includes(key),isMove=['ground','cityMoves','flightArchive'].includes(key);
  if(!isPlace&&!isMove)return;
  const old=new Map(before.map(r=>[r[def.id],r]));
  const metadata=new Set([...EVIDENCE_HEADERS,'里程类型','时长类型','线形类型']);
  for(const r of after){
    const previous=old.get(r[def.id]);
    if(previous&&def.headers.every(k=>(r[k]??'')===(previous[k]??'')))continue;
    const factualChanged=!previous||def.headers.some(k=>{
      // Reclassifying an already typed flight value (e.g. model -> observed)
      // changes its factual claim, even when the number itself is unchanged.
      if(key==='flightArchive'&&metadata.has(k)&&!EVIDENCE_HEADERS.includes(k)&&previous[k]&&(r[k]??'')!==(previous[k]??''))return true;
      if(metadata.has(k)||(r[k]??'')===(previous[k]??''))return false;
      // Making the old implicit defaults explicit is a schema change only.
      if(k==='计程纳入'&&!previous[k]&&r[k]==='是')return false;
      if(k==='记录类型'&&!previous[k]&&r[k]===(key==='cityMoves'?'活动移动':'旅行航段'))return false;
      return true;
    });
    const historical=migration&&previous&&!factualChanged;
    const validator=isPlace?validatePlaceEvidence:validateMovementEvidence;
    const reviewed=key==='flightArchive'?{...r,'发生依据':r['航段发生依据']}:r;
    const result=validator(reviewed,{city:key.startsWith('city'),allowHistoricalMigration:historical});
    if(!result.ok)throw new Error(`更新核定不完整 ${r[def.id]}：${result.errors.join('；')}`);
    if(factualChanged&&previous&&r['核定记录']===previous['核定记录'])throw new Error('事实修订须更新核定记录：'+r[def.id]);
  }
}

export function splitPlacePatches(patches=[],japaneseIds=new Set(),prefectures=[]){
  if(!Array.isArray(patches))throw new Error('places 必须为数组');
  const result={japanPlaces:[],regionPlaces:[]};
  for(const p of patches){
    const jp=p['国家代码']==='JP'||p['国家地区']==='日本'||japaneseIds.has(p['地点编号']);
    if(!jp){result.regionPlaces.push(p);continue;}
    if(p['国家代码']&&p['国家代码']!=='JP'||p['国家地区']&&p['国家地区']!=='日本')throw new Error('日本地点的国家信息冲突：'+p['地点编号']);
    const row={};
    for(const [k,v]of Object.entries(p)){
      if(['国家代码','国家地区'].includes(k))continue;
      if(k==='城市/地点')row['城市/城镇']=v;
      else if(k==='一级区域代码'){
        const id=String(v).replace(/^JP-/,'').padStart(2,'0'),pref=prefectures.find(r=>r[0]===id);
        if(!pref)throw new Error('日本区域代码未登记：'+v);row['都道府县代码']=id;row['都道府县']=pref[1];
      }else row[k]=v;
    }
    result.japanPlaces.push(row);
  }
  return result;
}

// A patch contains only changed fields. Existing evidence and original names survive.
export function mergeRows(rows,patches,idField,headers=Object.keys(rows[0]||{})){
  if(!Array.isArray(patches))throw new Error('每种更新必须是数组');
  const byId=new Map(rows.map(r=>[r[idField],{...r}])),seen=new Set();
  const changes={added:0,updated:0,unchanged:0};
  for(const patch of patches){
    if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new Error('更新行必须是字段对象');
    const id=patch[idField];if(typeof id!=='string'||!id.trim()||seen.has(id))throw new Error('更新编号缺失或重复：'+id);seen.add(id);
    for(const [field,value] of Object.entries(patch)){
      if(!headers.includes(field))throw new Error('未登记字段：'+field);
      if(value===null||!['string','number'].includes(typeof value)||!Number.isFinite(typeof value==='number'?value:0))throw new Error('字段须为字符串或有限数字，清空用空字符串：'+field);
    }
    const old=byId.get(id),next={...(old||Object.fromEntries(headers.map(h=>[h,'']))),...Object.fromEntries(Object.entries(patch).map(([k,v])=>[k,String(v)]))};
    if(!old)changes.added++;else if(headers.some(h=>old[h]!==next[h]))changes.updated++;else changes.unchanged++;
    byId.set(id,next);
  }
  return {rows:[...byId.values()],changes};
}

export async function updateAtlas({input,vault,dryRun=false,noRender=false,output,scope='all',variant='all',expectedSourceRevision,expectedInputSha256,operationId}={}){
  if(!input)throw new Error('请用 --input 指定更新JSON；只刷新图片用 npm run atlas');
  const catalog=await readJson(join(ROOT,'data/region-catalog.json'));
  if(!['all','world','japan',...Object.keys(catalog)].includes(scope)||!['all','personal','social'].includes(variant))throw new Error('出图范围或版本无效');
  const inputBytes=await readFile(resolve(input)),patch=JSON.parse(inputBytes);
  const inputRef={path:resolve(input),sha256:createHash('sha256').update(inputBytes).digest('hex')};
  if(expectedInputSha256&&inputRef.sha256!==expectedInputSha256)throw Object.assign(new Error('更新补丁已变化，请重新预览'),{code:'STALE_INPUT'});
  const config=await readAtlasConfig();
  const source=await resolveSource({vault,config});
  vault=source.base;output=resolve(output||config.output||join(ROOT,'outputs'));
  const snapshot=await updateSourceSnapshot(source.folder,source);
  requireSourceRevision(snapshot,expectedSourceRevision);
  if(patch.cityJourneys||patch.cityEvidence){
    const {updateCities}=await import('./update-cities.mjs');
    const report=await updateCities({patch,vault,dryRun,snapshot,operationId,inputRef,output,source});
    if(dryRun)return report;
    return buildUpdatedAtlas(report,{vault,source,output,scope,variant,noRender});
  }
  if(patch.version!==1||Object.keys(patch).some(k=>!['version','schemaMigration','places','evidenceWithdrawals',...Object.keys(definitions)].includes(k)))throw new Error('更新格式应为 version:1，以及 places、journeys、ground 数组（兼容原地点表键）');
  if(patch.schemaMigration!==undefined&&patch.schemaMigration!==8)throw new Error('仅允许本轮证据合同迁移版本8');
  if(!['places',...Object.keys(definitions)].some(k=>patch[k]?.length))throw new Error('更新文件没有更新行');
  // 已有错误归组必须能被修复；合并后的 after 仍执行完整时间校验。
  // Read a broken old chain only to repair it. The merged result below always
  // uses strict ordering, exact anchors and the full continuity gate.
  const loaded=await loadAtlas(undefined,{}, {source,validateDates:false,allowStaleConnections:true}),tables={},summary={};
  const split=splitPlacePatches(patch.places, new Set(loaded.sourceRows.japanPlaces.map(r=>r['地点编号'])),await readJson(join(ROOT,'data/japan-prefectures.json')));
  for(const [key,def]of Object.entries(definitions)){
    const path=sourcePath(loaded.source,def.file),original=await readFile(path,'utf8').catch(e=>{if(def.optional&&e.code==='ENOENT')return null;throw e;}),rows=original?parseCsv(original):[],headers=[...new Set([...def.headers,...Object.keys(rows[0]||{})])];
    const merged=mergeRows(rows,[...(patch[key]||[]),...(split[key]||[])],def.id,headers);
    validateEvidenceDelta(rows,merged.rows,key,{migration:patch.schemaMigration===8});
    tables[key]={path,original,headers,...merged};summary[key]=merged.changes;
  }
  // Keep occurrence references synchronized with changes to their actual owners.
  // Maintained manual reviews stay authoritative; stale manual references fail
  // validation and must be corrected in the same patch rather than discarded.
  const changedGraph=['flightArchive','ground','japanPlaces','regionPlaces','journeys'].some(k=>tables[k].changes.added||tables[k].changes.updated);
  if(changedGraph&&!patch.visits){
    const fresh=await loadAtlas(undefined,{...Object.fromEntries(Object.entries(tables).map(([k,t])=>[k,t.rows])),visits:[]},{source});
    const inferred=archiveBoundaryRows(fresh.atlas),manual=tables.visits.rows.filter(r=>!['历史迁移','地点证据迁移候选'].includes(r['核定方式']));
    const rows=mergeReviewedVisitRows(inferred,manual);
    const oldIds=new Set(tables.visits.rows.map(r=>r['到访编号']));
    tables.visits={...tables.visits,rows,changes:{added:rows.filter(r=>!oldIds.has(r['到访编号'])).length,updated:1,unchanged:0}};
    summary.visits=tables.visits.changes;
  }
  // Validate all combined source tables, including flight overlap, before the first write.
  const after=await loadAtlas(undefined,Object.fromEntries(Object.entries(tables).map(([k,t])=>[k,t.rows])),{source});
  const withdrawals=patch.evidenceWithdrawals||[];
  if(!Array.isArray(withdrawals)||withdrawals.some(w=>!w?.id||typeof w.reason!=='string'||!w.reason.trim()))throw new Error('证据撤回须逐条写出交通编号与核实理由');
  validateContinuityDelta(loaded.atlas,after.atlas,{withdrawnRoutes:withdrawals.map(w=>w.id)});
  const cityDetail=await loadCityDetails(loaded.folder,after.atlas,Object.fromEntries(Object.entries(tables).filter(([k])=>k.startsWith('city')).map(([k,t])=>[k,t.rows])),source);
  await validateLinks(loaded.vault,Object.values(tables).flatMap(t=>t.rows),{sourceType:source.type});
  const report={dryRun,input:inputRef,output,changes:summary,evidenceWithdrawals:withdrawals,before:loaded.atlas.meta,after:after.atlas.meta,
    layers:{places:after.atlas.locationLayer.summary,journeys:after.atlas.journeyLayer.summary,cities:cityDetail.report},
    changedJourneys:after.atlas.journeySummaries.filter(j=>{
      const old=loaded.atlas.journeySummaries.find(p=>p['行程编号']===j['行程编号']);return JSON.stringify(old)!==JSON.stringify(j);
    }).map(j=>({id:j['行程编号'],name:j['行程名称'],km:j['已计里程公里'],missingKm:j['缺里程路线数']})),
    regions:Object.fromEntries(Object.entries(after.atlas.regions).map(([k,v])=>[k,v.meta]))};
  const changes=Object.entries(tables).filter(([,t])=>t.changes.added||t.changes.updated).map(([key,t])=>({file:definitions[key].file,original:t.original,next:csv(t.rows,t.headers)}));
  const result=await applySourceUpdate({folder:loaded.folder,source,snapshot,changes,report,dryRun,operationId});
  if(dryRun)return result;
  return buildUpdatedAtlas(result,{vault:loaded.vault,source,output,scope,variant,noRender});
}

async function buildUpdatedAtlas(report,{vault,source,output,scope,variant,noRender}){
  try{
    if(noRender)await refreshAtlas({vault:source?.type==='obsidian'?vault:undefined,source,output,syncVault:true});
    else await renderAtlas({vault:source?.type==='obsidian'?vault:undefined,source,output,scope,variant,syncVault:true});
  }catch(error){
    throw Object.assign(error,{updateResult:await finishUpdate(report,{error})});
  }
  return finishUpdate(report,{artifacts:[{kind:'build_manifest',path:manifestPath(output)},...(!noRender?[{kind:'map',path:join(output,'site/index.html')}]:[])]});
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const json=process.argv.includes('--json');
  if(json)console.log=(...args)=>console.error(...args);
  try{
    const {values}=parseArgs({options:{input:{type:'string'},vault:{type:'string'},output:{type:'string'},scope:{type:'string',default:'all'},variant:{type:'string',default:'all'},'dry-run':{type:'boolean',default:false},'no-render':{type:'boolean',default:false},json:{type:'boolean'},'expected-source-revision':{type:'string'},'expected-input-sha256':{type:'string'},'operation-id':{type:'string'}}});
    const result=await updateAtlas({input:values.input,vault:values.vault,output:values.output&&resolve(values.output),scope:values.scope,variant:values.variant,dryRun:values['dry-run'],noRender:values['no-render'],expectedSourceRevision:values['expected-source-revision'],expectedInputSha256:values['expected-input-sha256'],operationId:values['operation-id']});
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
  }catch(error){if(json)process.stdout.write(JSON.stringify(updateErrorResult(error),null,2)+'\n');else console.error(error.message);process.exitCode=1;}
}
