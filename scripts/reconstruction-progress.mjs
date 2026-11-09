import {managedConnectionsFor} from './continuity-audit.mjs';

// Progress describes recovered movements, not merely whether a gap has an ID.
export function reconstructionProgress(atlas){
  const managed=managedConnectionsFor(atlas),moves=managed.filter(r=>r.recordType==='接驳段');
  const pending=moves.filter(r=>r.structuralLink||r.status==='待还原'||r.km==null||r.travelMinutes==null);
  const restored=moves.filter(r=>!pending.includes(r));
  const intervals=new Set(managed.filter(r=>r.recordType==='资料间隔').map(r=>r.id));
  const pendingIds=new Set(pending.map(r=>r.id));
  const visits=(atlas.visitInstances||[]).filter(v=>v.include),touches=(v,ids)=>[...v.incoming,...v.outgoing].some(id=>ids.has(id));
  const r=atlas.mobility?.reconstruction,dispositions=r?.dispositions||[];
  const countBy=(rows,key)=>Object.fromEntries([...new Set(rows.map(r=>r[key]))].map(k=>[k,rows.filter(r=>r[key]===k).length]));
  return {state:pending.length?'movement-incomplete':'managed-movements-restored',
    connections:{restored:restored.length,pending:pending.length,identityRelations:managed.filter(r=>r.recordType==='节点对应').length,
      observationIntervals:intervals.size,restoredKm:+restored.reduce((s,r)=>s+(r.km||0),0).toFixed(3),
      restoredMinutes:restored.reduce((s,r)=>s+(r.travelMinutes||0),0)},
    visits:{complete:visits.filter(v=>v.access?.complete).length,missingAccess:visits.filter(v=>v.access?.pending).length,
      missingMovement:visits.filter(v=>touches(v,pendingIds)).length,
      observationCoverageOnly:visits.filter(v=>touches(v,intervals)&&!touches(v,pendingIds)).length},
    observations:{reconstructedMoves:r?.moves.length||0,handled:dispositions.length,handledByResolution:countBy(dispositions,'resolution'),
      pending:r?.conflicts.length||0,pendingByType:countBy(r?.conflicts||[],'kind')},
    interpretation:'已恢复移动可包含方式、道路或日期的不确定性；资料间隔不是缺少一段交通，观测冲突不是整次旅行未重建。'};
}

export function connectionReconstructionRows(atlas){
  return managedConnectionsFor(atlas).map(r=>({'连接编号':r.id,'记录类型':r.recordType,'前序交通编号':r.previousTransport,
    '前序路线段':r.previousSegment,'后序交通编号':r.nextTransport,'后序路线段':r.nextSegment,
    '路线':r.names.join(' → '),'开始日期':r.startDate,'结束日期':r.endDate,
    '处理结果':r.recordType==='节点对应'?'身份对应，不是移动':r.recordType==='资料间隔'?'观测覆盖间隔':r.structuralLink?'移动未恢复':'已合理重建',
    '交通方式':r.mode,'里程公里':r.km??'','交通分钟':r.travelMinutes??'','计程纳入':r.countDistance===false?'否':'是',
    '里程类型':r.distanceType,'时长类型':r.durationType,'核定与不确定范围':r.review?.record||r.evidence,'关联正文':r.source}));
}
