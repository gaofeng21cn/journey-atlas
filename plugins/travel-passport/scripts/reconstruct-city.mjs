import {greatCircleKm} from './travel-layers.mjs';
import {pointInFeature} from './region-map.mjs';
import {cityDate} from './city-evidence.mjs';

// Raw observations remain unchanged. This is a reproducible interpretation of
// their time order, not a second place archive or a claim of sightseeing.
export const CITY_RECONSTRUCTION_VERSION=1;
const km=(a,b)=>greatCircleKm([a[1],a[0]],[b[1],b[0]]);
const round=(n,d=2)=>Number(n.toFixed(d));
const pathKm=points=>points.slice(1).reduce((s,p,i)=>s+km(points[i],p),0);
const validPoint=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;

export function movingWindows(track,{maxSpeed=140}={}){
  const p=track.points,t=track.sampleTimes,a=track.sampleAccuracies;
  if(!p?.length||!t||p.length!==t.length||p.some(p=>!validPoint(p))||t.some((n,i)=>!Number.isFinite(n)||i&&n<=t[i-1]))return [];
  const result=[];let first=-1,last=-1,quiet=0,minutes=0;
  const finish=()=>{
    if(first>=0&&last>first){const points=p.slice(first,last+1),distance=pathKm(points);
      // Reject drift around one stationary position, even if its cumulative
      // zigzags are long. Retain real return loops with spatial excursion.
      const spread=Math.max(...points.map(q=>km(points[0],q)));
      if(distance>=.2&&spread>=.15)result.push({start:t[first],end:t[last],points,km:distance,minutes,trackId:track.id});
    }
    first=last=-1;quiet=minutes=0;
  };
  for(let i=1;i<p.length;i++){
    const span=(t[i]-t[i-1])/60,distance=km(p[i-1],p[i]),speed=distance/span*60;
    const noise=Math.max(.025,((a?.[i]||20)+(a?.[i-1]||20))*.65/1000);
    const moving=distance>noise&&(speed>=1.5||distance>=.18)&&speed<=maxSpeed;
    if(moving){
      if(first<0)first=i-1;last=i;quiet=0;
      // Low speed in a long retained interval may mix a stay with movement.
      minutes+=speed<1.5?Math.min(span,distance/4.5*60):span;
    }else{quiet+=span;if(quiet>=10||speed>maxSpeed)finish();}
  }
  finish();return result;
}

function photoStops(points){
  const groups=[];
  for(const p of [...points].sort((a,b)=>a.time-b.time)){
    if(!Number.isFinite(p.time)||!validPoint([p.lon,p.lat]))continue;
    const last=groups.at(-1),point=[p.lon,p.lat];
    if(last&&p.time-last.end<=3600&&km(last.points[0],point)<=.12){last.end=p.time;last.refs.push('photo:'+p.uuid);last.samples++;}
    else groups.push({start:p.time,end:p.time,points:[point],refs:['photo:'+p.uuid],samples:1,kind:'photo'});
  }
  return groups;
}

export function estimateCityMove(points,{elapsedMinutes=null,gpsMinutes=null,source='gap',regional=false}={}){
  const chord=pathKm(points),isGps=source==='gps';
  // An unobserved route is a distance model; the chord is never labelled GPS.
  let distance=chord*(isGps?1:chord<1.2?1.2:regional&&chord>=30?1.25:1.3);
  const speed=gpsMinutes?chord/gpsMinutes*60:null;
  const walk=isGps?speed<=6.5:chord<=1.2;
  const mode=walk?'步行':regional&&chord>=30?'地面交通待定':'市内交通';
  let minutes=isGps?gpsMinutes:walk?distance/4.5*60:regional&&chord>=30?distance/55*60+8:distance/22*60+4;
  if(elapsedMinutes>0&&minutes>elapsedMinutes){minutes=elapsedMinutes;distance=Math.max(chord,Math.min(distance,elapsedMinutes*120/60));}
  const minKm=chord*(isGps?.9:1),maxKm=distance*(isGps?1.15:1.5);
  const minMinutes=Math.max(.001,isGps?minutes*.8:chord/(walk?6:50)*60);
  const maxMinutes=Math.max(minutes,Math.min(elapsedMinutes||Infinity,isGps?minutes*1.3:minutes*1.8+5));
  return {km:round(distance),travelMinutes:round(Math.max(.001,minutes),3),mode,
    distanceRange:[round(minKm),round(maxKm)],durationRange:[round(Math.min(minMinutes,minutes),3),round(maxMinutes,3)],
    distanceType:'model',durationType:'model',geometryType:isGps?'observed':'model',
    measurementBasis:isGps?'GPS线形去漂移与停留分段后推断；距离和活动时间为模型':'有序观测端点间道路绕行系数与步行/市内交通速度模型',
    confidence:isGps?'high':elapsedMinutes&&elapsedMinutes<120?'medium':'low'};
}

export function reconstructCity({config,geometry,evidence,places=[],resolveNode,canConnect}){
  const days=new Map(),conflicts=[],dispositions=[],nodes=new Map(),visits=[],moves=[],journeys=[];
  const add=(date,atom)=>{if(!days.has(date))days.set(date,[]);days.get(date).push(atom);};
  let stationaryTracks=0;
  for(const track of evidence.tracks||[]){
    const windows=movingWindows(track,{maxSpeed:config.maxSpeed||140});
    if(!windows.length)stationaryTracks++;
    for(const w of windows)add(track.date,{...w,kind:'gps',refs:['gps:'+track.id]});
    // A stationary track is still an anchor for entering/leaving this place.
    if(!windows.length&&track.start&&track.end)add(track.date,{start:track.start,end:track.end,points:[track.points[0]],refs:['gps:'+track.id],kind:'stay'});
  }
  const localDate=(time,point)=>cityDate(time,config.timeZoneAt?config.timeZoneAt(point[1],point[0]):config.timeZone);
  for(const s of photoStops(evidence.photoPoints||[]))add(localDate(s.start,s.points[0]),s);
  for(const s of evidence.stays||[])if(Number.isFinite(s.start)&&Number.isFinite(s.end))add(localDate(s.start,[s.lon,s.lat]),{start:s.start,end:s.end,points:[[s.lon,s.lat]],refs:['stay:'+s.start],kind:'stay'});
  const nodeAt=point=>{
    const key=point.map(n=>n.toFixed(4)).join(','),id='loc:'+config.id+':'+key;
    if(!nodes.has(id)){
      if(resolveNode){nodes.set(id,{...resolveNode(point),id,lat:point[1],lon:point[0],active:false,visited:false,level:'定位节点'});return nodes.get(id);}
      const district=geometry.features.find(f=>pointInFeature(point,f)),near=places.filter(p=>p.level!=='区域接续').map(p=>({p,d:km(point,[p.lon,p.lat])})).sort((a,b)=>a.d-b.d)[0];
      nodes.set(id,{id,lat:point[1],lon:point[0],cityId:district?config.id:null,districtId:district?.id||null,country:config.country,unitId:config.unitId,active:false,visited:false,level:'定位节点',name:near?.d<.2?near.p.name:(district?.properties.name||config.name)+'·记录点'});
    }
    return nodes.get(id);
  };
  let previous=null;
  for(const [date,raw] of [...days].sort(([a],[b])=>a.localeCompare(b))){
    const tripId='recon:'+config.id+':'+date,ordered=raw.sort((a,b)=>a.start-b.start||(a.kind==='gps'?-1:1)),atoms=[];
    for(const atom of ordered){
      const last=atoms.at(-1);
      if(last&&atom.start<last.end){
        if(atom.kind!=='gps'){
          const close=last.points.some(p=>km(p,atom.points[0])<.35);
          if(close){last.refs.push(...atom.refs);continue;}
          dispositions.push({date,kind:'overlapping-position',start:atom.start,end:atom.end,references:atom.refs,
            acceptedReferences:[...last.refs],from:[last.points[0][1],last.points[0][0]],to:[atom.points[0][1],atom.points[0][0]],
            resolution:'overlap-source-selected',reason:last.kind==='gps'?'连续GPS优先于重叠照片/停留；不另造同时发生的移动':'重叠观测不能证明独立移动；保留时间链上的观测，未反写原始时间或坐标'});continue;
        }
        // A long photo/stay window cannot obscure a later GPS movement. Its
        // start is a contact event, not a continuous stay across that window.
        last.end=Math.min(last.end,atom.start);
      }
      atoms.push({...atom,refs:[...atom.refs]});
    }
    for(let i=1;i<atoms.length;i++)if(atoms[i-1].kind!=='gps')atoms[i-1].end=Math.min(atoms[i-1].end,atoms[i].start);
    const dailyMoves=[],dailyVisits=[];
    let lastVisit=null;
    const visit=(point,start,end,refs)=>{
      const node=nodeAt(point);
      const separation=lastVisit?km([nodes.get(lastVisit.nodeId).lon,nodes.get(lastVisit.nodeId).lat],point):Infinity;
      // Very brief sub-500m GPS discontinuities are positional uncertainty,
      // not an extra journey. Keep the contact and the original references.
      if(lastVisit&&(separation<.15||separation<.5&&Math.abs(start-lastVisit.end)<60)){
        lastVisit.positionUncertaintyMeters=Math.max(lastVisit.positionUncertaintyMeters||0,Math.round(separation*1000));
        lastVisit.end=Math.max(lastVisit.end,end);lastVisit.references.push(...refs);return lastVisit;
      }
      const v={id:tripId+':v'+String(dailyVisits.length+1).padStart(4,'0'),nodeId:node.id,tripId,date,start,end,references:[...refs],incoming:[],outgoing:[]};
      visits.push(v);dailyVisits.push(v);lastVisit=v;return v;
    };
    const connect=(from,to,atom,kind)=>{
      if(from.id===to.id)return;
      const a=nodes.get(from.nodeId),b=nodes.get(to.nodeId),points=kind==='gps'?atom.points:[[a.lon,a.lat],[b.lon,b.lat]],elapsed=(atom.end-atom.start)/60;
      const assessment=canConnect?.(a,b,{...atom,kind,date});
      if(assessment?.coveredBy?.length){
        dispositions.push({date,kind:'archived-transport-covered',start:atom.start,end:atom.end,fromNodeId:a.id,toNodeId:b.id,
          from:[a.lat,a.lon],to:[b.lat,b.lon],references:atom.refs,referenceIds:assessment.coveredBy,
          resolution:'existing-movement',reason:'同向观测窗口由已登记交通覆盖；沿用原交通公里与时间，不通过地面速度阈值，也不重复计量'});
        from.boundary='已登记交通接续';to.boundary='已登记交通接续';return;
      }
      if(canConnect&&assessment===false){
        const distanceKm=pathKm([[a.lon,a.lat],[b.lon,b.lat]]),windowMinutes=Math.max(0,(atom.end-atom.start)/60);
        conflicts.push({date,kind:'transport-evidence-gap',start:atom.start,end:atom.end,fromNodeId:a.id,toNodeId:b.id,
          from:[a.lat,a.lon],to:[b.lat,b.lon],distanceKm,windowMinutes,speedKmh:windowMinutes?distanceKm/(windowMinutes/60):null,references:atom.refs});
        from.boundary='跨区域移动需要交通依据';to.boundary='跨区域移动需要交通依据';return;
      }
      if(elapsed<=0||pathKm(points)/elapsed*60>(config.maxSpeed||140)){
        const distanceKm=pathKm(points),speedKmh=elapsed?distanceKm/(elapsed/60):null;
        conflicts.push({date,kind:'impossible-speed',start:atom.start,end:atom.end,elapsed,windowMinutes:elapsed,km:distanceKm,distanceKm,speedKmh,
          from:[a.lat,a.lon],to:[b.lat,b.lon],fromNodeId:a.id,toNodeId:b.id,references:atom.refs});
        from.boundary='观测冲突后的窗口结束';to.boundary='观测冲突后的窗口开始';return;
      }
      const metrics=estimateCityMove(points,{elapsedMinutes:elapsed,gpsMinutes:atom.minutes,source:kind,regional:config.regional});
      const id=tripId+':m'+String(dailyMoves.length+1).padStart(4,'0');
      const move={id,tripId,date,startDate:localDate(atom.start,points[0]),endDate:localDate(atom.end,points.at(-1)),order:dailyMoves.length+1,
        fromVisitId:from.id,toVisitId:to.id,fromNodeId:a.id,toNodeId:b.id,start:atom.start,end:atom.end,windowMinutes:round(elapsed),
        ...metrics,path:points.map(p=>[...p]),sourceKind:kind,evidenceReferences:[...atom.refs],occurrenceStatus:'合理重构',recordType:'定位重建',countDistance:true,countDuration:true};
      moves.push(move);dailyMoves.push(move);from.outgoing.push(id);to.incoming.push(id);
    };
    for(const atom of atoms){
      const first=atom.points[0],old=lastVisit,v=visit(first,atom.start,atom.start,atom.refs);
      if(old&&v!==old)connect(old,v,{start:old.end,end:atom.start,refs:[...old.references,...atom.refs]},'gap');
      if(atom.kind==='gps'){
        // A loop returns to the same node but to a new visit instance.
        const saved=lastVisit;lastVisit=null;
        const end=visit(atom.points.at(-1),atom.end,atom.end,atom.refs);lastVisit=end;
        connect(saved,end,atom,'gps');
      }else v.end=Math.max(v.end,atom.end);
    }
    // Adjacent-day contacts can restore an overnight connection, without
    // counting the overnight window as time spent travelling. Longer source
    // gaps remain explicit boundaries, not a fabricated excursion/return.
    if(previous&&dailyVisits.length){
      const first=dailyVisits[0],gap=first.start-previous.end;
      if(gap>0&&gap<=16*3600&&km([nodes.get(previous.nodeId).lon,nodes.get(previous.nodeId).lat],[nodes.get(first.nodeId).lon,nodes.get(first.nodeId).lat])>=.1)
        connect(previous,first,{start:previous.end,end:first.start,refs:[...previous.references,...first.references]},'gap');
    }
    for(const v of dailyVisits){if(!v.incoming.length)v.boundary||='本次资料窗口起点';if(!v.outgoing.length)v.boundary||='本次资料窗口终点';}
    if(dailyVisits.length)previous=dailyVisits.at(-1);
    if(dailyMoves.length)journeys.push({id:tripId,cityId:config.id,name:date+' · 重建移动',first:date,last:dailyMoves.reduce((s,m)=>s>m.endDate?s:m.endDate,date),moveIds:dailyMoves.map(m=>m.id),visitIds:dailyVisits.map(v=>v.id),kind:'reconstructed'});
  }
  for(const j of journeys){
    const chain=moves.filter(m=>m.tripId===j.id).sort((a,b)=>a.start-b.start||a.end-b.end);
    chain.forEach((m,i)=>m.order=i+1);j.moveIds=chain.map(m=>m.id);
    j.first=chain[0].startDate;
  }
  // Update boundaries after next-day links were registered.
  for(const v of visits)if(v.incoming.length&&v.outgoing.length)delete v.boundary;
  const used=new Set(moves.flatMap(m=>[m.fromVisitId,m.toVisitId]));
  const connected=visits.filter(v=>used.has(v.id)),stationary=visits.filter(v=>!used.has(v.id));
  const usedNodes=new Set(connected.map(v=>v.nodeId));
  return {version:CITY_RECONSTRUCTION_VERSION,policy:{stationaryMinutes:10,noiseRadiusMeters:25,minMovementKm:.2,maxSpeedKmh:config.maxSpeed||140,overnightGapHours:16,
    time:'当地日期；定位窗口与推断交通时长独立',distance:'全部移动包含通勤；全局逐段对账计量，城市复用同一物理移动投影',visits:'位置接触不自动核定景点或行政覆盖'},
    nodes:[...nodes.values()].filter(n=>usedNodes.has(n.id)),visits:connected,moves,journeys,stationary,conflicts,dispositions,
    summary:{journeys:journeys.length,moves:moves.length,gpsMoves:moves.filter(m=>m.sourceKind==='gps').length,gapMoves:moves.filter(m=>m.sourceKind==='gap').length,
      km:round(moves.reduce((s,m)=>s+m.km,0)),travelMinutes:round(moves.reduce((s,m)=>s+m.travelMinutes,0)),stationaryTracks,stationaryVisits:stationary.length,conflicts:conflicts.length,handledObservations:dispositions.length,
      distanceRange:[0,1].map(i=>round(moves.reduce((s,m)=>s+m.distanceRange[i],0))),durationRange:[0,1].map(i=>round(moves.reduce((s,m)=>s+m.durationRange[i],0)))}};
}

export function validateCityReconstruction(r){
  const nodes=new Map(r.nodes.map(n=>[n.id,n])),visits=new Map(r.visits.map(v=>[v.id,v])),ids=new Set(),gps=[];
  for(const m of r.moves){
    const a=visits.get(m.fromVisitId),b=visits.get(m.toVisitId);
    if(ids.has(m.id)||!a||!b||!nodes.has(m.fromNodeId)||!nodes.has(m.toNodeId)||a.nodeId!==m.fromNodeId||b.nodeId!==m.toNodeId)throw new Error('重建移动引用无效：'+m.id);
    ids.add(m.id);
    if(!(m.end>m.start&&m.km>0&&m.travelMinutes>0)||m.distanceType!=='model'||m.durationType!=='model'||m.travelMinutes>m.windowMinutes+.02)throw new Error('重建计量或时间窗无效：'+m.id);
    if(!a.outgoing.includes(m.id)||!b.incoming.includes(m.id))throw new Error('访问实例与移动双向引用不一致：'+m.id);
    if(m.sourceKind==='gps')gps.push(m);
  }
  for(const v of r.visits){
    if(!v.incoming.length&&!v.outgoing.length||(!v.incoming.length||!v.outgoing.length)&&!v.boundary)throw new Error('重建访问缺少接续或资料边界：'+v.id);
    for(const id of [...v.incoming,...v.outgoing])if(!ids.has(id))throw new Error('重建访问引用失效：'+v.id);
  }
  gps.sort((a,b)=>a.start-b.start);
  for(let i=1;i<gps.length;i++)if(gps[i].start<gps[i-1].end)throw new Error('同一GPS窗口重复计量：'+gps[i].id);
  for(const j of r.journeys){
    const chain=j.moveIds.map(id=>r.moves.find(m=>m.id===id));
    if(chain.some((m,i)=>!m||m.order!==i+1||i&&m.start<chain[i-1].end))throw new Error('重建日链时间或顺序矛盾：'+j.id);
  }
  return {nodes:nodes.size,visits:visits.size,moves:ids.size};
}
