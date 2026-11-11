import {writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {validateCityReconstruction} from './reconstruct-city.mjs';

import {csv} from './csv.mjs';
export async function writeGlobalMobility(mobility,output){
  const r=mobility.reconstruction;validateCityReconstruction(r);await mkdir(output,{recursive:true});
  const sourceOwners=new Map(mobility.excluded.map(m=>[m.id,m.referenceId])),newMoves=new Map(mobility.additions.map(m=>[m.id.replace(/^MOB-/,''),m]));
  const nodes=new Map(r.nodes.map(n=>[n.id,n]));
  const rows=r.moves.map(m=>({'移动编号':m.id,'日链编号':m.tripId,'日期':m.date,'段序':m.order,'出发访问编号':m.fromVisitId,'到达访问编号':m.toVisitId,'出发节点编号':m.fromNodeId,'到达节点编号':m.toNodeId,
    '出发位置':nodes.get(m.fromNodeId).name,'到达位置':nodes.get(m.toNodeId).name,'出发国家地区':nodes.get(m.fromNodeId).country,'到达国家地区':nodes.get(m.toNodeId).country,
    '开始UTC':new Date(m.start*1000).toISOString(),'结束UTC':new Date(m.end*1000).toISOString(),'观测窗口分钟':m.windowMinutes,'推断移动公里':m.km,'推断交通分钟':m.travelMinutes,
    '距离范围公里':m.distanceRange.join('—'),'时长范围分钟':m.durationRange.join('—'),'全局新增计程':newMoves.has(m.id)?'是':'否','全局新增公里':newMoves.get(m.id)?.km||0,'全局新增交通分钟':newMoves.get(m.id)?.travelMinutes||0,'既有交通计量归属':sourceOwners.get(m.id)||'',
    '来源类型':m.sourceKind,'模型依据':m.measurementBasis,'证据引用':m.evidenceReferences.join('；')}));
  const reconciliation=mobility.ownership.map(o=>({'原交通编号':o.referenceId,'起始路线段':o.segment,'末路线段':o.endSegment||o.segment,'关联移动编号':o.moveIds.join('；'),'原统计公里':+o.originalKm.toFixed(3),'定位链公里':+o.recoveredKm.toFixed(3),'归属区间':o.coverageFraction?.join('—')||'完整节点序列','既有覆盖公里':o.coveredKm??o.recoveredKm,'观测未覆盖新增公里':o.additionalKm||0,'规则类型':o.action,'采用规则':o.action==='refine-reference'?'定位链细化原模型':'既有交通拥有计量，观测不重复累加','依据':o.reason}));
  await Promise.all([
    writeFile(join(output,'全球移动-明细.csv'),csv(rows)),writeFile(join(output,'全球移动-对账.csv'),csv(reconciliation)),
    writeFile(join(output,'全球移动-汇总.json'),JSON.stringify({summary:mobility.summary,observations:mobility.observations,scope:mobility.policy.scope,handledObservations:(r.dispositions||[]).length},null,2)+'\n'),
    writeFile(join(output,'全球移动-观测处置.csv'),csv((r.dispositions||[]).map(c=>({'日期':c.date,'原问题':c.kind,'处置':c.resolution,
      '出发坐标':c.from?.join(',')||'','到达坐标':c.to?.join(',')||'','既有交通编号':c.referenceIds?.join('；')||'',
      '证据引用':c.references?.join('；')||'','保留证据':c.acceptedReferences?.join('；')||'','处理依据':c.reason})))),
    writeFile(join(output,'全球移动-待核.csv'),csv(r.conflicts.map(c=>({'日期':c.date,'问题类型':c.kind,'出发节点编号':c.fromNodeId||'','到达节点编号':c.toNodeId||'',
      '出发坐标':c.from?.join(',')||'','到达坐标':c.to?.join(',')||'','观测开始UTC':c.start?new Date(c.start*1000).toISOString():'','观测结束UTC':c.end?new Date(c.end*1000).toISOString():'',
      '观测窗口分钟':c.windowMinutes??c.elapsed??'','端点大圆公里':c.distanceKm??c.km??'','端点速度公里每小时':c.speedKmh??'','证据引用':c.references?.join('；')||'',
      '不确定字段':c.uncertainFields?.join('；')||'','下一步核实':c.nextAction||'',
      '处理':'原始观测保留；这里只剩原件身份或时空冲突，不代表相关旅程整体停止重建'})))),
    writeFile(join(output,'全球移动-轨迹.json'),JSON.stringify(r)+'\n')]);
}
