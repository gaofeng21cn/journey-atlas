import {transportMode} from './route-semantics.mjs';

// Travel time means time in motion, not calendar days spent travelling.
// Flight durations belong to the maintained movement source. A missing flight
// duration stays missing here; browser-only estimates would disagree with the
// atlas and static flight card. Known ground modes can use a distance model.
export function travelTime(route){
  if(route.include===false||route.countDuration===false||route.structuralLink||route.candidate||['区域接续','资料间隔'].includes(route.recordType))return {minutes:null,estimated:false,type:route.durationType||'unknown',counted:false,basis:route.travelDurationBasis||route.durationBasis||'未恢复具体移动，不计时长'};
  const supplied=route.travelMinutes??(route.mode==='飞机'?route.minutes:null);
  const type=route.durationType||'unknown';
  if(Number.isFinite(supplied)&&supplied>0)return {minutes:supplied,estimated:!['observed','archived'].includes(type),type,counted:true,basis:route.travelDurationBasis||route.durationBasis||'原交通记录时长，来源类型未核'};
  if(route.mode==='飞机')return {minutes:null,estimated:false,type:'unknown',counted:true,basis:'维护航段未记录飞行时长；补充核定后统一计入'};
  if(!Number.isFinite(route.km)||route.km<=0)return {minutes:null,estimated:false,type:'unknown',counted:true,basis:'缺少时长与可估算里程'};
  const speed={铁路:100,公路:route.km<=30?30:60,轮渡:25,缆车:10,山地交通:8,地面交通:route.km<=50?25:50,地面交通待定:route.km<=50?25:50,市内交通:20,步行:4.5}[route.sourceMode||route.mode];
  if(!speed)return {minutes:null,estimated:false,type:'unknown',counted:true,basis:'未登记交通方式的时长模型'};
  return {minutes:Math.max(1,Math.round(route.km/speed*60)),estimated:true,type:'model',counted:true,basis:`${route.mode}里程÷平均${speed}公里/小时（含常见减速与停靠；不含游览与住宿）`};
}

export function durationSummary(routes){
  const modes=new Map();let minutes=0,estimated=0,missing=0,excluded=0;
  for(const r of routes){const time=travelTime(r);if(!time.counted){excluded++;continue;}if(time.minutes===null){missing++;continue;}minutes+=time.minutes;if(time.estimated)estimated++;
    const mode=transportMode(r);modes.set(mode,(modes.get(mode)||0)+time.minutes);}
  return {minutes,hours:Math.round(minutes/6)/10,estimated,missing,excluded,
    modes:[...modes].map(([mode,minutes])=>({mode,minutes,hours:Math.round(minutes/6)/10})).sort((a,b)=>b.minutes-a.minutes)};
}
