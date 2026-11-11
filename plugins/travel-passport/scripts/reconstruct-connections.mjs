import {sourcePath} from './source-data.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {loadAtlas,parseCsv} from './atlas-data.mjs';
import {TABLES} from './schema.mjs';
import {buildManagedLinkRows} from './managed-links.mjs';
import {greatCircleKm,canonicalName} from './travel-layers.mjs';
import {deriveVisitInstances,visitInstanceRows,readVisitInstances,mergeReviewedVisitRows} from './visit-instances.mjs';
import {privatePatchOutput} from './infer-links.mjs';

// Continue after gap management. Decisions describe precisely what is inferred,
// not a claim of an exact road, vehicle, day or unrecorded sightseeing stop.
const recordDate=value=>{
  const date=value||new Date().toISOString().slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(`${date}T00:00:00Z`))||new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date)throw new Error('重建记录日期必须为有效的 YYYY-MM-DD');
  return date;
};
export function reconstructConnection(row,{before,after,aliases,curation={},recordedOn}={}){
  const date=recordDate(recordedOn);
  const points=JSON.parse(row['坐标序列纬经']),names=row['途经节点'].split('；');
  const km=greatCircleKm(points[0],points[1]);
  const sameName=canonicalName(names[0],aliases)===canonicalName(names[1],aliases);
  const decision=curation[row['交通编号']];
  if(row['记录类型']==='资料间隔')return {row,category:'record-interval',uncertainty:'期间日常活动未全量观测；不是缺少单次交通'};
  if(decision?.identity){
    return {row:{...row,'记录类型':'节点对应','发生状态':'合理重构','核定结论':'合理重构','计程纳入':'否',
      '发生依据':decision.basis,'核定方式':'证据复核','核定记录':`${date} 节点身份复核：${decision.basis}；窗口：${row['开始日期']}—${row['结束日期']}`,
      '备注':'同一实体的来源坐标或名称不同，不构造额外移动；保留原始端点以便追溯'},category:'identity',uncertainty:decision.uncertainty||'原始来源坐标精度不同'};
  }
  const start=row['开始日期'],end=row['结束日期'];
  const days=(Date.parse(end.length===10?end:end+'-01'.repeat(end.length===4?2:1))-Date.parse(start.length===10?start:start+'-01'.repeat(start.length===4?2:1)))/86400000;
  // Long historical gaps are not one journey. Preserve the review target,
  // rather than padding an entire unobserved year with a single straight leg.
  if(!decision&&km>400&&days>60)return {row,category:'needs-context',uncertainty:`${start}至${end}资料相隔${Math.round(days)}天；缺中间活动与交通记录，端点距${km.toFixed(1)}公里，不能唯一确定一次或多次移动`};
  if(km<=.05&&!decision)return {row,category:'needs-identity',uncertainty:'代表坐标相同但交通/地面身份不同；需按具体机场或市区端点核定，不能补造固定接驳公里'};
  let mode=decision?.mode||'地面交通';
  if(km>400&&!decision)mode='交通方式待定';
  const factor=decision?.factor||({铁路:1.2,公路:1.25,地面交通:1.25,飞机:1.03,交通方式待定:1.05}[mode]||1.25);
  const distance=+(km*factor).toFixed(3);
  const minutes=decision?.minutes||Math.max(1,Math.round(distance/(mode==='铁路'?90:mode==='飞机'?650:mode==='交通方式待定'?160:distance<50?25:55)*60+(mode==='飞机'?35:0)));
  const uncertainty=decision?.uncertainty||`${sameName?'同城端点接驳':'端点间必要移动'}；具体${mode==='交通方式待定'?'交通大类、':'车辆、'}路网及发车钟点不确定；${start===end?'保留原日/月精度':'发生日期只在前后资料窗口内定位'}；只补一段必要接续，不补中间游览`;
  const basis=decision?.basis||`前序${before.id}到达${names[0]}，后序${after.id}自${names[1]}继续，真实端点与时间顺序限定必要移动。采用${mode}的端点连接模型；没有新增中途到访地点。`;
  return {row:{...row,'交通方式':mode,'交通工具':decision?.vehicle||'','发生状态':'合理重构','核定结论':'合理重构','核定方式':'证据复核',
    '发生依据':basis,'核定记录':`${date} 合理重建：${basis}；窗口：${start}—${end}；不确定项：${uncertainty}`,
    '里程公里':distance,'里程依据':`已发生必要接续的原始端点大圆距离×${factor}；模型范围${km.toFixed(3)}—${(distance*1.5).toFixed(3)}公里，不代表实测道路`,
    '交通时长分钟':minutes,'交通时长依据':`端点里程与${mode}速度模型；${minutes}分钟，不用资料日期跨度代替交通耗时`,
    '里程类型':'model','时长类型':'model','线形类型':'display','计程纳入':'是','备注':uncertainty},category:'reconstructed',uncertainty};
}

export function retainReviewedConnection(candidate,existing,curation={}){
  if(!existing||curation[candidate['交通编号']]||existing['分享纳入']!=='纳入'||
    !['已发生','合理重构'].includes(existing['核定结论'])&&existing['记录类型']!=='资料间隔')return null;
  const anchors=['前序交通编号','后序交通编号','前序路线段','后序路线段','节点编号序列','坐标序列纬经','开始日期','结束日期'];
  if(anchors.some(k=>String(existing[k]??'')!==String(candidate[k]??'')))return null;
  return {row:existing,category:existing['记录类型']==='节点对应'?'identity':existing['记录类型']==='资料间隔'?'record-interval':'reconstructed',
    uncertainty:existing['备注']||existing['核定记录']};
}

export async function prepareReconstruction({curation={},sourcePatch={},vault,source,recordedOn}={}){
  const date=recordDate(recordedOn);
  const loaded=await loadAtlas(vault,{visits:[]},{source,allowStaleConnections:true}),sourceRows=loaded.sourceRows;
  const merge=(rows,patch,key)=>{const map=new Map(rows.map(r=>[r[key],r]));for(const r of patch||[])map.set(r[key],{...map.get(r[key]),...r});return [...map.values()];};
  const {atlas}=await loadAtlas(undefined,{visits:[],
    flightArchive:merge(sourceRows.flightArchive,sourcePatch.flightArchive,'证据编号'),
    ground:merge(sourceRows.ground.filter(r=>!['接驳段','资料间隔','节点对应'].includes(r['记录类型'])),sourcePatch.ground,'交通编号'),
    journeys:merge(sourceRows.journeys,sourcePatch.journeys,'行程编号')},{source:loaded.source});
  const ordinary=(atlas.referenceRoutes||atlas.routes).filter(r=>!['接驳段','资料间隔','节点对应'].includes(r.recordType)&&!r.mobility);
  const context={places:atlas.locationLayer.places,routes:ordinary,journeys:atlas.journeyLayer.journeys};
  const manual=parseCsv(await readFile(sourcePath(loaded.source,TABLES.visits),'utf8')).filter(r=>!['历史迁移','地点证据迁移候选'].includes(r['核定方式']));
  const visits=readVisitInstances(mergeReviewedVisitRows(visitInstanceRows(deriveVisitInstances(context)),manual),context);
  const clean={...atlas,routes:ordinary,managedConnections:[],connectionIntervals:[],visitInstances:visits};
  const result=buildManagedLinkRows(clean),byId=new Map(ordinary.map(r=>[r.id,r]));
  const maintained=new Map(sourceRows.ground.map(r=>[r['交通编号'],r]));
  const decisions=result.rows.map(row=>retainReviewedConnection(row,maintained.get(row['交通编号']),curation)||
    reconstructConnection(row,{before:byId.get(row['前序交通编号']),after:byId.get(row['后序交通编号']),aliases:atlas.journeyLayer.aliases,curation,recordedOn:date}));
  const active=new Set(decisions.map(d=>d.row['交通编号']));
  const retired=sourceRows.ground.filter(r=>['接驳段','资料间隔','节点对应'].includes(r['记录类型'])&&r['分享纳入']==='纳入'&&!active.has(r['交通编号'])).map(r=>({...r,'分享纳入':'排除','发生状态':'排除','核定结论':'排除','核定方式':'证据复核',
    '核定记录':`${date} 重新核对交通顺序；该接续在修正已登记有向链顺序后不再为真实相邻缺口，保留原行追溯，不补造额外移动`,
    '备注':'原顺序产生的非相邻连接已撤回；不是撤回原客票或已发生旅行'}));
  const summary=Object.fromEntries([...Map.groupBy(decisions,d=>d.category)].map(([k,v])=>[k,v.length]));
  return {patch:{...sourcePatch,version:1,ground:[...(sourcePatch.ground||[]),...retired,...decisions.map(d=>d.row)]},review:{summary,retired:retired.length,issues:result.issues,decisions:decisions.map(d=>({id:d.row['交通编号'],route:d.row['途经节点'],window:d.row['日期或区间'],category:d.category,uncertainty:d.uncertainty,km:d.row['里程公里'],minutes:d.row['交通时长分钟']}))}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const {values}=parseArgs({options:{vault:{type:'string'},curation:{type:'string'},source:{type:'string'},output:{type:'string'},write:{type:'boolean',default:false},'recorded-on':{type:'string'}}});
  const reviewed=values.curation?JSON.parse(await readFile(values.curation,'utf8')):{};
  const curation=reviewed.curation||reviewed;
  const sourcePatch=values.source?JSON.parse(await readFile(values.source,'utf8')):reviewed.sourcePatch||{};
  const {patch,review}=await prepareReconstruction({vault:values.vault,curation,sourcePatch,recordedOn:values['recorded-on']});console.log(JSON.stringify(review,null,2));
  if(values.write||values.output){const path=privatePatchOutput(values.output,'connection-reconstruction.json');await mkdir(join(path,'..'),{recursive:true});await writeFile(path,JSON.stringify(patch,null,2)+'\n');await writeFile(path.replace(/\.json$/,'.review.json'),JSON.stringify(review,null,2)+'\n');}
}
