import {readAtlasConfig} from './source-data.mjs';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {reconstructionProgress} from './reconstruction-progress.mjs';
import {resolve,join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {readJson,ROOT,WORKSPACE_ROOT} from './data.mjs';
import {TABLES} from './schema.mjs';
import {loadAtlas,parseCsv} from './atlas-data.mjs';
import {updateAtlas} from './update-atlas.mjs';
import {inspectUpdate,updateSourceSnapshot,updateErrorResult} from './update-operation.mjs';
import {validateLinks} from './source-references.mjs';
import {renderAtlas} from './render-atlas.mjs';
import {createContinuityAudit,managedConnectionsFor} from './continuity-audit.mjs';
import {compareManifest,manifestPath} from './manifest.mjs';
import {loadCityDetails,CITY_FILES} from './city-data.mjs';

const usage=`旅行护照：地点 → 行程 → 分享图片

npm run passport -- status                   查看数据层、各地区统计及输出新鲜度
npm run passport -- check                    只读校验全部资料与正文回链
npm run passport -- trace --id <编号>        查地点、行程或交通及其关联
npm run passport -- access                  查看地点接入队列
npm run passport -- update --input 更新.json [--dry-run] [--json]
npm run passport -- receipt --id <operation-id> --json   回读更新结果，不重放写入
npm run passport -- build [--scope japan] [--variant social]

update按编号合并并备份，默认刷新汇总和全部图片；build默认同步派生表。
--no-render只更新数据/汇总；--output指定出图目录；--vault指定资料库。
--json输出结构化查询、更新及错误结果。更新可用 --expected-source-revision 绑定预览版本，--operation-id 绑定回执。来源表不从分享图片或缓存反向更新。`;

function closureSummary(a){
  const rows=a.journeyContinuity||[];
  return {groups:rows.length,balanced:rows.filter(r=>r['闭环状态']==='行程内闭环').length,
    crossJourney:rows.filter(r=>r['闭环状态']==='跨行程接续').length,
    boundaries:rows.filter(r=>r['闭环状态']==='开放接续（有依据）').length,pending:rows.filter(r=>r['闭环状态']==='待接续').length};
}
export function passportSummary(a){
  const reconstruction=reconstructionProgress(a),managed=managedConnectionsFor(a);
  return {locations:a.locationLayer.summary,itineraries:a.journeyLayer.summary,closure:closureSummary(a),reconstruction,
  mobility:a.mobility?{...a.mobility.summary,observations:a.mobility.observations,scope:a.mobility.policy.scope}:null,
  visits:a.visitInstanceSummary||{records:0,shared:0,complete:0,pending:0,awaitingReview:0},
  connections:{maintained:managed.length,awaitingRestoration:reconstruction.connections.pending,
    observationIntervals:reconstruction.connections.observationIntervals,candidates:(a.hubLinks||[]).filter(c=>c.candidate===true).length},
  sharing:{...a.meta,flightHours:Math.round(a.meta.flightMinutes/60)},japan:a.japan,
  regions:Object.fromEntries(Object.entries(a.regions).map(([k,v])=>[k,v.meta])),
  trajectory:a.trajectorySummary,
  nodeReferences:a.nodeReferenceSummary,
  improvements:Object.fromEntries([...new Set(a.improvements.map(r=>r['类型']))].map(k=>[k,a.improvements.filter(r=>r['类型']===k).length]))};}
export function traceAtlasRecord(a,id){
  const place=a.locationLayer.places.find(p=>p.id===id),journey=a.journeyLayer.journeys.find(j=>j.id===id);
  const visits=a.visitInstances||[],visit=visits.find(v=>v.id===id),managed=managedConnectionsFor(a);
  const transports=a.journeyLayer.journeys.flatMap(j=>j.transport),transport=transports.find(r=>r.id===id)||a.routes.find(r=>r.id===id)||managed.find(r=>r.id===id);
  if(visit)return {layer:'到访实例',record:visit,place:a.locationLayer.places.find(p=>p.id===visit.placeId),
    journey:a.journeyLayer.journeys.find(j=>j.id===visit.journeyId),
    entering:visit.incoming.map(id=>transports.find(r=>r.id===id)||a.routes.find(r=>r.id===id)||managed.find(r=>r.id===id)),
    leaving:visit.outgoing.map(id=>transports.find(r=>r.id===id)||a.routes.find(r=>r.id===id)||managed.find(r=>r.id===id)),
    note:'结构接入与事实核定分别保存；必要连接和资料间隔不证明期间的具体路径或驻留。'};
  if(place)return {layer:'地点',record:place,journeys:a.journeyLayer.journeys.filter(j=>j.baseId===id||j.transport.some(r=>r.nodePlaceIds?.includes(id))).map(j=>({id:j.id,name:j.name,base:j.base,source:j.source})),
    visits:visits.filter(v=>v.placeId===id),
    references:a.nodeReferences.filter(r=>r['地点编号']===id||r['服务城市地点编号']===id),note:'明确地点引用与机场服务城市关联分别展示；机场接触不证明到访。'};
  if(journey)return {layer:'行程',record:journey,summary:a.journeySummaries.find(j=>j['行程编号']===id),visits:visits.filter(v=>v.journeyId===id),
    connections:managed.filter(r=>journey.transportIds.includes(r.previousTransport)||journey.transportIds.includes(r.nextTransport))};
  if(transport)return {layer:transport.recordType==='资料间隔'?'资料间隔':'交通',record:transport,journey:journey||a.journeyLayer.journeys.find(j=>j.transportIds.includes(id))?.id||'',
    visits:visits.filter(v=>v.incoming.includes(id)||v.outgoing.includes(id)),
    places:(transport.nodePlaceIds||[]).map(id=>a.locationLayer.places.find(p=>p.id===id))};
  throw new Error('未找到编号：'+id);
}

export async function reviewArtifact(kind,path){
  try{const bytes=await readFile(path);return {kind,path,state:'available',revision:createHash('sha256').update(bytes).digest('hex')};}
  catch(error){if(error.code==='ENOENT')return {kind,path,state:'missing',revision:null};throw error;}
}

async function main(){
  const {values,positionals}=parseArgs({allowPositionals:true,options:{input:{type:'string'},vault:{type:'string'},output:{type:'string'},scope:{type:'string',default:'all'},variant:{type:'string',default:'all'},id:{type:'string'},json:{type:'boolean',default:false},help:{type:'boolean',default:false},'dry-run':{type:'boolean',default:false},'no-render':{type:'boolean',default:false},'no-sync':{type:'boolean',default:false},'expected-source-revision':{type:'string'},'expected-input-sha256':{type:'string'},'operation-id':{type:'string'}}});
  const command=positionals[0]||'status';if(values.help||command==='help'){console.log(usage);return;}
  if(positionals.length>1)throw new Error('多余参数；用 --help 查看用法');
  const common={vault:values.vault,output:values.output&&resolve(values.output),scope:values.scope,variant:values.variant};
  if(command==='build'){if(values['dry-run']||values.input||values['no-render'])throw new Error('build不导入更新，使用update --dry-run预览');await renderAtlas({...common,syncVault:!values['no-sync']});return;}
  if(command==='update'){
    const log=console.log;if(values.json)console.log=(...args)=>console.error(...args);
    try{const report=await updateAtlas({...common,input:values.input,dryRun:values['dry-run'],noRender:values['no-render'],expectedSourceRevision:values['expected-source-revision'],expectedInputSha256:values['expected-input-sha256'],operationId:values['operation-id']});process.stdout.write(JSON.stringify(report,null,2)+'\n');}
    finally{console.log=log;}
    return;
  }
  if(command==='receipt'){
    if(!values.id)throw new Error('receipt 需要 --id');
    if(values.input||values.vault||values.output||values['dry-run']||values['no-render']||values['operation-id']||values['expected-source-revision']||values['expected-input-sha256'])throw new Error('receipt 只接受 --id 与 --json');
    process.stdout.write(JSON.stringify(await inspectUpdate(values.id),null,2)+'\n');return;
  }
  if(values['operation-id']||values['expected-source-revision']||values['expected-input-sha256'])throw new Error('operation 与源版本参数仅用于 update');
  if(!['status','check','trace','access'].includes(command))throw new Error('未知命令；用 --help 查看用法');
  if(values.input||values['dry-run']||values['no-render']||values.output)throw new Error('查询/检查命令只读，不接受更新或输出参数');
  const {atlas,sourceRows,vault,folder,source}=await loadAtlas(values.vault);
  const {sourcePath}=await import('./source-data.mjs');
  const candidates=parseCsv(await readFile(sourcePath(source,TABLES.visitCandidates),'utf8'));
  const audit=createContinuityAudit(atlas,candidates);
  if(command==='check'){
    await validateLinks(vault,Object.values(sourceRows).flat(),{source});
    await loadCityDetails(folder,atlas,{},source);
    for(const name of CITY_FILES.slice(0,2))try{await validateLinks(vault,parseCsv(await readFile(sourcePath(source,name),'utf8')),{source});}catch(e){if(e.code!=='ENOENT')throw e;}
    if(audit.summary.structuralErrors)throw new Error('数据结构仍有未管理缺口或引用/时间矛盾：'+JSON.stringify(audit.summary));
  }
  if(command==='trace'){if(!values.id)throw new Error('trace需要 --id');console.log(JSON.stringify(traceAtlasRecord(atlas,values.id),null,2));return;}
  if(command==='access'){
    const pending=atlas.locationLayer.places.filter(p=>p.access?.pending).map(p=>({'地点编号':p.id,'国家地区':p.country,'地点名称':p.name,'接入状态':p.access.state,'接入交通编号':p.access.routes.join('；'),'交通节点关联数':p.access.transportRoutes.length,'待接入原因':p.access.reason,'关联正文':p.source}));
    console.log(values.json?JSON.stringify(pending,null,2):pending.map(p=>`${p['地点编号']} ${p['国家地区']}/${p['地点名称']}：${p['待接入原因']}`).join('\n'));
    return;
  }
  const runtimeConfig=await readAtlasConfig();
  const outputDir=runtimeConfig.output||join(WORKSPACE_ROOT,'outputs');
  const freshness=await compareManifest(manifestPath(outputDir),folder,ROOT,undefined,source);
  const report=passportSummary(atlas);
  report.build={state:freshness.state,changed:freshness.changed,lastGeneratedAt:freshness.manifest?.generatedAt||null,lastRenderedAt:freshness.manifest?.render?.generatedAt||null};
  report.continuity=audit.summary;
  report.source=await updateSourceSnapshot(folder,source);
  report.review={pending:atlas.improvements.map(r=>({id:r['对象编号'],journeyId:r['关联行程编号'],kind:r['类型'],summary:r['待完善内容'],source:r['关联正文']})),
    artifacts:await Promise.all([reviewArtifact('build_manifest',manifestPath(outputDir)),reviewArtifact('map',join(outputDir,'site/index.html'))])};
  const structural={
    formalDisconnected:report.continuity.formalDisconnected||0,
    visitDisconnected:report.continuity.visitDisconnected||0,
    dateScopeViolations:report.continuity.dateScopeViolations||0,
    orderConflicts:report.continuity.orderConflicts||0,
    nodeReferenceGaps:report.continuity.nodeReferenceGaps||0,
    missingKm:report.trajectory?.missingKm||0,
    unresolvedRoutes:report.nodeReferences?.unresolvedRoutes||0,
    pendingAccess:report.locations?.pendingAccess||0,
  };
  const structuralErrors=Object.values(structural).reduce((sum,n)=>sum+n,0);
  report.quality={
    state:freshness.state==='fresh'&&structuralErrors===0?'ready':freshness.state!=='fresh'?'rebuild-required':'repair-required',
    structuralErrors,
    reconstruction:report.reconstruction,
    structural,
    evidenceBoundary:{
      closurePending:report.closure.pending||0,
      visitsAwaitingRestoration:report.reconstruction.visits.missingMovement,
      visitsObservationCoverageOnly:report.reconstruction.visits.observationCoverageOnly,
      managedConnectionsAwaitingRestoration:report.connections.awaitingRestoration||0,
      observationIntervals:report.connections.observationIntervals||0,
      mobilityConflicts:report.mobility?.conflicts||0,
    },
  };
  if(values.json){console.log(JSON.stringify({command,...report},null,2));return;}
  console.log(command==='check'?'资料结构、行程关联与正文回链检查通过。':'旅行护照数据');
  console.log(`地点层：${report.locations.records}条，核定${report.locations.confirmed}、待核${report.locations.candidates}、途经/机场${report.locations.transit}、计划${report.locations.planned}。`);
  console.log(`地点接入：已到访且纳入分享的地点中，${report.locations.connected}个已接入，${report.locations.pendingAccess}个待接入。`);
  console.log(`到访实例：${report.visits.shared}次纳入，${report.visits.complete}次前后结构完整，${report.visits.pending}次缺接续；${report.reconstruction.visits.missingMovement}次移动待还原、${report.reconstruction.visits.observationCoverageOnly}次仅资料覆盖间隔。`);
  console.log(`接续管理：${report.connections.maintained}条正式关系，其中${report.connections.awaitingRestoration}条待还原、${report.connections.observationIntervals}条资料间隔；${report.connections.candidates}条算法候选尚未登记。`);
  const progress=report.reconstruction;
  console.log(`实际重建进度：${progress.connections.restored}条接驳已恢复、${progress.connections.pending}条移动待恢复、${progress.connections.identityRelations}条仅节点对应；${progress.visits.observationCoverageOnly}次到访只涉及资料覆盖间隔。`);
  console.log(`观测处置：${progress.observations.handled}项已有去重/来源选择结论，${progress.observations.pending}项原件时空问题仍需核实；不把它们统称为未重建行程。`);
  console.log(`行程层：${report.itineraries.journeys}条行程归组，${report.itineraries.records}条交通，${report.itineraries.linkedRoutes}条引用地点，${report.itineraries.unassigned}条待归组。`);
  console.log(`行程闭环：${report.closure.groups}个组，${report.closure.balanced}个往返闭合，${report.closure.crossJourney}个跨行程承接，${report.closure.boundaries}个有依据的开放接续，${report.closure.pending}个待接续。`);
  console.log(`分享统计：${report.sharing.totalKm.toLocaleString('en-US')}公里，飞行${report.sharing.flightHours.toLocaleString('en-US')}小时；${report.sharing.missingKm}条路线公里仍空。`);
  if(report.mobility)console.log(`全量移动：${report.mobility.observations.usableGps.toLocaleString('en-US')}条有效GPS、${report.mobility.observations.photos.toLocaleString('en-US')}个照片位置；新增${report.mobility.additionalMoves}段计程，${report.mobility.coveredMoves}段由既有交通拥有计量，${report.mobility.refinedReferences}条原模型经定位链细化。口径：${report.mobility.scope}。`);
  console.log(`原档案轨迹：${report.trajectory.legs}条记录，${report.trajectory.joined}处证实接续，${report.continuity.trajectoryBreaks+report.continuity.unmanagedConnections}处未管理缺口，${report.continuity.managedTrajectoryTransitions}处已管理接续或资料边界；原档案合计${report.trajectory.km.toLocaleString('en-US')}公里（不含新增定位移动）。`);
  console.log(`路线节点引用：${report.nodeReferences.explicitRoutes}条路线全节点有编号，${report.nodeReferences.transportNodeRoutes}条含交通节点，${report.nodeReferences.unresolvedRoutes}条名称仍待核。`);
  console.log('待完善：'+(Object.entries(report.improvements).map(([k,v])=>k+v+'项').join('；')||'无')+'。');
  console.log(`质量门禁：${report.quality.state}；结构问题${report.quality.structuralErrors}项，${report.quality.evidenceBoundary.visitsAwaitingRestoration}次到访移动待还原、${report.quality.evidenceBoundary.managedConnectionsAwaitingRestoration}条接驳待恢复；${report.quality.evidenceBoundary.observationIntervals}条资料间隔、${report.quality.evidenceBoundary.mobilityConflicts}条观测冲突独立保留。`);
  console.log(`输出状态：${report.build.state==='fresh'?'与维护源一致':report.build.state==='stale'?'维护源已有变化，需重新构建':'尚未生成构建清单'}${report.build.changed.length?'（'+report.build.changed.join('、')+'）':''}。`);
  console.log('行程归组数量不等于已确认旅行次数；地点核定仅指当前维护表覆盖范围。');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{if(process.argv.includes('--json'))process.stdout.write(JSON.stringify(updateErrorResult(e),null,2)+'\n');else console.error(e.message);process.exitCode=1;});
