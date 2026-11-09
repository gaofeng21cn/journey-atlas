import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {ROOT,readJson} from './data.mjs';
import {loadAtlas,parseCsv} from './atlas-data.mjs';
import {UPDATE_DEFINITIONS,EVIDENCE_HEADERS,SCHEMA_VERSION} from './schema.mjs';
import {mergeRows,splitPlacePatches} from './update-atlas.mjs';
import {archiveBoundaryRows,visitInstanceSummary,readVisitInstances} from './visit-instances.mjs';
import {buildManagedLinkRows} from './managed-links.mjs';
import {sourcePath} from './source-data.mjs';

const placeKeys=['japanPlaces','regionPlaces','cityPlaces'];
const moveKeys=['ground','cityMoves'];
const conclusion=row=>({已到访:'地面到访','途经/机场':'交通接触',交通节点:'交通接触',待核:'待核',计划:'计划'})[row['到访状态']]||'待核';
const sameFact=(a,b,headers)=>a&&headers.every(k=>EVIDENCE_HEADERS.includes(k)||(a[k]??'')===(b[k]??''));
const recordDate=value=>{
  const date=value||new Date().toISOString().slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(`${date}T00:00:00Z`))||new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date)throw new Error('迁移记录日期必须为有效的 YYYY-MM-DD');
  return date;
};
export function migrationReview(row,key,old,recordedOn){
  const def=UPDATE_DEFINITIONS[key],isPlace=placeKeys.includes(key);
  const date=recordDate(recordedOn);
  const changed=!sameFact(old,row,def.headers.filter(k=>!['里程类型','时长类型','线形类型','计程纳入'].includes(k)));
  if(row['核定结论']&&row['核定方式']&&row['证据引用']&&row['核定记录'])return row;
  const refs=[...(row['关联正文']||'').split('；').filter(Boolean).map(s=>'正文:'+s),`表行:${def.file}#${row[def.id]}`];
  if(isPlace&&row['照片来源关联编号'])refs.push(...row['照片来源关联编号'].split('；').filter(Boolean).map(s=>'照片:'+s));
  let decision=isPlace?conclusion(row):'合理重构';
  if(!isPlace){
    if(row['分享纳入']==='排除')decision='排除';
    else if(row['发生状态']==='待还原')decision='待核';
    else if(row['发生状态']==='计划')decision='计划';
    // Preserve an already-maintained explicit conclusion; no free-text GPS inference.
    else if(['本人确认','本人确认方式','本人确认路线','正文与本人确认','本人确认/照片GPS','照片GPS/正文明确','画面支持'].includes(row['发生状态']))decision='已发生';
  }
  return {...row,'核定结论':decision,'核定方式':changed?'证据复核':'历史迁移','证据引用':refs.join('；'),
    '核定记录':changed?`${date} 按已核正文与原记录修正；${isPlace?row['核定依据']:row['发生依据']}`:
      `${date} 证据合同迁移：沿用原维护判断与依据，未新增到访、方式、班次或日期核定；${isPlace?row['核定依据']:row['发生依据']}`};
}

// Preview-only schema migration. Personal curation is supplied as ignored input;
// this reusable generator contains no personal routes or identity decisions.
export async function migrationPatch({vault,source,curations=[],output,recordedOn}={}){
  const date=recordDate(recordedOn);
  const loaded=await loadAtlas(vault,{}, {source,validateDates:false}),tables={},original={};
  for(const [key,def] of Object.entries(UPDATE_DEFINITIONS)){
    const rows=await readFile(sourcePath(loaded.source,def.file),'utf8').then(parseCsv).catch(e=>{if(def.optional&&e.code==='ENOENT')return [];throw e;});
    original[key]=rows;tables[key]=rows;
  }
  const pref=await readJson(join(ROOT,'data/japan-prefectures.json'));
  for(const file of curations){
    const patch=await readJson(resolve(file));
    const split=splitPlacePatches(patch.places,new Set(tables.japanPlaces.map(r=>r['地点编号'])),pref);
    for(const [key,def] of Object.entries(UPDATE_DEFINITIONS))tables[key]=mergeRows(tables[key],[...(patch[key]||[]),...(split[key]||[])],def.id,def.headers).rows;
  }
  for(const key of [...placeKeys,...moveKeys]){
    const def=UPDATE_DEFINITIONS[key],byId=new Map(original[key].map(r=>[r[def.id],r]));
    tables[key]=tables[key].map(row=>{
      if(moveKeys.includes(key)){
        const city=key==='cityMoves',km=row[city?'里程公里':'里程公里'],duration=row[city?'交通时长分钟':'飞行时长分钟']||row['交通时长分钟'];
        row={...row,'里程类型':row['里程类型']||(km||row['距离模型']?'model':'unknown'),
          '时长类型':row['时长类型']||(duration?'model':'unknown'),'线形类型':row['线形类型']||'display','计程纳入':row['计程纳入']||'是'};
      }
      return migrationReview(row,key,byId.get(row[def.id]),date);
    });
  }
  let after=await loadAtlas(undefined,{...tables,visits:[]},{source:loaded.source});
  const connections=buildManagedLinkRows(after.atlas);
  tables.ground=mergeRows(tables.ground,connections.rows,'交通编号',UPDATE_DEFINITIONS.ground.headers).rows;
  after=await loadAtlas(undefined,{...tables,visits:[]},{source:loaded.source});
  tables.visits=archiveBoundaryRows(after.atlas);
  let checked;
  try{checked=readVisitInstances(tables.visits,{places:after.atlas.locationLayer.places,routes:after.atlas.routes,journeys:after.atlas.journeyLayer.journeys,connectors:after.atlas.managedConnections});}
  catch(e){const row=tables.visits.find(r=>e.message.includes(r['到访编号']));throw new Error(e.message+' / '+JSON.stringify(row),{cause:e});}
  const patch={version:1,schemaMigration:SCHEMA_VERSION};
  for(const [key,def] of Object.entries(UPDATE_DEFINITIONS)){
    const old=new Map(original[key].map(r=>[r[def.id],r]));
    patch[key]=tables[key].filter(r=>!old.has(r[def.id])||def.headers.some(k=>(r[k]??'')!==(old.get(r[def.id])[k]??'')));
  }
  const report={schemaVersion:SCHEMA_VERSION,connections:connections.summary,connectionIssues:connections.issues,
    visits:visitInstanceSummary(checked),pending:checked.filter(v=>v.include&&v.access.pending).map(v=>({id:v.id,placeId:v.placeId,place:after.atlas.locationLayer.places.find(p=>p.id===v.placeId)?.name,journey:v.journeyId,window:[v.startDate,v.endDate],incoming:v.incoming,outgoing:v.outgoing,reason:v.access.reason})),
    changes:Object.fromEntries(Object.entries(patch).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length]))};
  if(output){await mkdir(resolve(output,'..'),{recursive:true});await writeFile(resolve(output),JSON.stringify(patch,null,2)+'\n');await writeFile(resolve(output)+'.report.json',JSON.stringify(report,null,2)+'\n');}
  return {patch,report,tables,atlas:after.atlas};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const {values}=parseArgs({options:{vault:{type:'string'},curation:{type:'string',multiple:true},output:{type:'string'},'recorded-on':{type:'string'}}});
  migrationPatch({vault:values.vault,curations:values.curation||[],output:values.output,recordedOn:values['recorded-on']}).then(({report})=>console.log(JSON.stringify(report,null,2))).catch(e=>{console.error(e.stack);process.exitCode=1;});
}
