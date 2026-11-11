import {excludesWalkingCount} from './route-semantics.mjs';
// City records include a reproducible movement interpretation as well as
// curated sightseeing. Coverage stays curated; mobility uses all evidence.
export function cityPassportSummary(view){
  if(!view.scope.cityId||view.scope.detailKind==='province')return null;
  const activities=new Set(view.routes.filter(r=>!r.reconstructed&&r.tripId&&!r.candidate&&r.include!==false&&r.evidence?.conclusion!=='排除').map(r=>r.tripId)).size;
  const recordedDays=view.observationDays?.length||0;
  const supporting=[];
  if(!view.scope.districtId)supporting.push({value:`${view.stats.visited} / ${view.stats.total}`,label:view.scope.unitLabel||'到访行政区'});
  if(view.reconstruction){
    supporting.push({value:view.reconstruction.moves,label:excludesWalkingCount(view.scope)?'段交通移动':'段城市移动'});
    supporting.push({value:view.reconstruction.hours||view.reconstruction.minutes,label:view.reconstruction.hours?'小时交通移动':'分钟交通移动'});
  }else{
    if(activities)supporting.push({value:activities,label:'次已整理活动'});
    if(recordedDays)supporting.push({value:recordedDays,label:'个记录日'});
  }
  return {places:view.stats.places,activities,recordedDays,reconstruction:view.reconstruction,supporting};
}
