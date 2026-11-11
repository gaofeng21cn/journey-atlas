import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {csv} from './csv.mjs';
import {validateCityReconstruction} from './reconstruct-city.mjs';

// Private, derived reading tables are never embedded in the browser payload.
export async function writeCityReconstructions(detail,output){
  await mkdir(output,{recursive:true});
  const moves=[],visits=[],summary=[],reconstructions={};
  for(const [id,city]of Object.entries(detail.cities)){
    const r=city.reconstruction;if(!r||city.derived)continue;
    validateCityReconstruction(r);reconstructions[id]=r;
    const nodes=new Map(r.nodes.map(n=>[n.id,n]));
    for(const m of r.moves)moves.push({'城市编号':id,'移动编号':m.id,'日链编号':m.tripId,'日期':m.date,'段序':m.order,'出发访问编号':m.fromVisitId,'到达访问编号':m.toVisitId,
      '出发节点编号':m.fromNodeId,'到达节点编号':m.toNodeId,'出发位置':nodes.get(m.fromNodeId).name,'到达位置':nodes.get(m.toNodeId).name,
      '观测窗口开始UTC':new Date(m.start*1000).toISOString(),'观测窗口结束UTC':new Date(m.end*1000).toISOString(),'观测窗口分钟':m.windowMinutes,
      '推断方式':m.mode,'推断移动公里':m.km,'距离范围公里':m.distanceRange.join('—'),'推断交通分钟':m.travelMinutes,'时长范围分钟':m.durationRange.join('—'),
      '重建来源':m.sourceKind==='gps'?'连续定位去停留':'时序端点合理接续','计量类型':'model','置信度':m.confidence,'重建依据':m.measurementBasis,'证据引用':m.evidenceReferences.join('；')});
    for(const v of r.visits)visits.push({'城市编号':id,'访问编号':v.id,'节点编号':v.nodeId,'日期':v.date,'位置名称':nodes.get(v.nodeId).name,'纬度':nodes.get(v.nodeId).lat,'经度':nodes.get(v.nodeId).lon,
      '进入移动编号':v.incoming.join('；'),'离开移动编号':v.outgoing.join('；'),'资料窗口边界':v.boundary||'','位置不确定米':v.positionUncertaintyMeters||'','证据引用':v.references.join('；')});
    summary.push({'城市编号':id,'重建日链':r.summary.journeys,'重建移动':r.summary.moves,'定位支持移动':r.summary.gpsMoves,'合理接续移动':r.summary.gapMoves,
      '重建移动公里':r.summary.km,'推断交通小时':Math.round(r.summary.travelMinutes/60),'距离范围公里':r.summary.distanceRange.join('—'),'时间范围小时':r.summary.durationRange.map(n=>Math.round(n/60)).join('—'),
      '单点或静止记录':r.summary.stationaryVisits,'定位冲突':r.summary.conflicts,'范围说明':'城市内定位/照片支持的移动重建；包括生活、工作和旅行，不叠加全球总里程'});
  }
  await Promise.all([
    writeFile(join(output,'城市移动重建-移动.csv'),csv(moves)),writeFile(join(output,'城市移动重建-访问实例.csv'),csv(visits)),
    writeFile(join(output,'城市移动重建-汇总.csv'),csv(summary)),writeFile(join(output,'城市移动重建.json'),JSON.stringify(reconstructions)+'\n')]);
  return summary;
}
