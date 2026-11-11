import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ROOT,readJson} from './data.mjs';
import {parseCsv} from './csv.mjs';
import {pointInFeature} from './region-map.mjs';
import {boundsOf} from '../src/scope-model.mjs';
import {OPTIONAL_SOURCE_FILES} from './schema.mjs';
import {atlasConnections,mergeDetailConnections} from './detail-connections.mjs';
import {greatCircleKm,canonicalName} from './travel-layers.mjs';
import {validatePlaceEvidence,validateMovementEvidence} from './evidence-contract.mjs';
import {cityDate} from './city-evidence.mjs';
import {reconstructCity} from './reconstruct-city.mjs';
import {projectMobility} from './global-mobility.mjs';
import {sourcePath} from './source-data.mjs';

const metricTypes=new Set(['observed','archived','reference','model','unknown']);
const geometryTypes=new Set([...metricTypes,'display']);
const numberOrNull=value=>value===undefined||value===null||String(value).trim()===''?null:Number(value);

// A coarse regional continuation records the existence of a connection. Its
// representative point cannot supply kilometres, minutes or a precise origin.
export function cityMovementMetadata(row,{legacy=true}={}){
  const id=row['移动编号'],recordType=row['记录类型']||'活动移动',coarse=recordType==='区域接续';
  if(!['活动移动','区域接续','交通接驳'].includes(recordType))throw new Error('城市移动记录类型无效：'+id);
  const typed=['计程纳入','里程类型','时长类型','线形类型'].some(k=>String(row[k]||'').trim());
  const countDistance=coarse?false:row['计程纳入']!=='否',countDuration=countDistance;
  const distanceType=row['里程类型']||'unknown',durationType=row['时长类型']||'unknown',geometryType=row['线形类型']||(row['路线几何经纬']?'display':'model');
  if(typed&&(!['是','否'].includes(row['计程纳入'])||!metricTypes.has(row['里程类型'])||!metricTypes.has(row['时长类型'])||!geometryTypes.has(row['线形类型'])))throw new Error('城市移动数值来源类型不完整：'+id);
  const km=numberOrNull(row['里程公里']),travelMinutes=numberOrNull(row['交通时长分钟']);
  if(!row['发生依据']||!row['关联正文'])throw new Error('城市移动缺少发生依据或正文：'+id);
  if(coarse){
    if(typed&&row['计程纳入']!=='否'||km!==null||travelMinutes!==null||row['路线几何经纬'])throw new Error('区域接续不能冒充精确里程、时长或轨迹：'+id);
    if(distanceType!=='unknown'||durationType!=='unknown'||geometryType!=='unknown')throw new Error('区域接续须保留未知数值和线形：'+id);
  }else{
    if(!(km>0&&travelMinutes>0)||!row['里程依据']||!row['时长依据'])throw new Error('城市移动缺少正数里程、时长或对应依据：'+id);
    if(typed&&(distanceType==='unknown'||durationType==='unknown'))throw new Error('已有计程数值须明确来源类型：'+id);
  }
  const review=validateMovementEvidence(row,{legacy,city:true,allowHistoricalMigration:!legacy});
  if(!review.ok)throw new Error('城市移动核定无效：'+id+'；'+review.errors.join('；'));
  if(['待核','排除'].includes(review.evidence.conclusion)&&countDistance)throw new Error('未核或排除的城市移动不能计程：'+id);
  return {recordType,countDistance,countDuration,distanceType,durationType,geometryType,km,travelMinutes,
    distanceBasis:row['里程依据']||'',travelDurationBasis:row['时长依据']||'',occurrenceBasis:row['发生依据'],source:row['关联正文'],evidence:review.evidence,
    trackId:row['GPS轨迹编号']||null,observedStart:numberOrNull(row['GPS开始时间']),observedEnd:numberOrNull(row['GPS结束时间'])};
}

export function validateCityTripAccess(places,routes,trips){
  const visits=[];
  for(const t of trips){
    if(!t.source||!/^\d{4}-\d{2}-\d{2}$/.test(t.first)||!/^\d{4}-\d{2}-\d{2}$/.test(t.last)||t.first>t.last)throw new Error('城市行程缺少有效日期或正文：'+t.id);
    const chain=routes.filter(r=>r.tripId===t.id).sort((a,b)=>a.order-b.order);
    if(!chain.length||new Set(chain.map(r=>r.order)).size!==chain.length)throw new Error('城市行程无移动或段序重复：'+t.id);
    for(let i=1;i<chain.length;i++)if(chain[i-1].nodes.at(-1).id!==chain[i].nodes[0].id||chain[i-1].date>chain[i].date)throw new Error('城市行程存在瞬移或日期逆序：'+t.id);
    const active=new Map(places.filter(p=>p.active).map(p=>[p.id,p]));
    for(let i=0;i<=chain.length;i++){
      const incoming=i?chain[i-1]:null,outgoing=i<chain.length?chain[i]:null,p=active.get(incoming?.nodes.at(-1).id||outgoing?.nodes[0].id);if(!p)continue;
      const boundary=(!incoming||!outgoing)&&t.basePlaceId===p.id&&t.boundaryBasis;
      if((!incoming||!outgoing)&&!boundary)throw new Error('城市到访实例缺少进入或离开移动：'+t.id+' / '+p.name);
      visits.push({id:t.id+'|'+p.id+'|'+(incoming?.id||'start'),tripId:t.id,placeId:p.id,
        first:incoming?.date||t.first,last:outgoing?.date||t.last,incoming:incoming?[incoming.id]:[],outgoing:outgoing?[outgoing.id]:[],
        boundary:boundary?{role:incoming?'end':'start',basis:t.boundaryBasis}:null,coarse:incoming?.recordType==='区域接续'||outgoing?.recordType==='区域接续'});
    }
  }
  return visits;
}

export function validateObservedCityRoute(route,evidence){
  if(route.geometryType!=='observed')return;
  const track=evidence.tracks?.find(t=>t.id===route.trackId),times=track?.sampleTimes,cumulative=track?.sampleCumulativeKm,accuracies=track?.sampleAccuracies;
  if(!track||!times||!cumulative||!accuracies||times.length!==track.points.length||cumulative.length!==track.points.length||accuracies.length!==track.points.length||times.some((v,i)=>!Number.isFinite(v)||v<=0||i&&v<=times[i-1])||cumulative.some((v,i)=>!Number.isFinite(v)||v<0||i&&v<cumulative[i-1])||accuracies.some(v=>!Number.isFinite(v)||v<=0||v>100))throw new Error('实测城市移动未引用可核对的GPS片段：'+route.id);
  const start=times.indexOf(route.observedStart),end=times.indexOf(route.observedEnd);
  if(start<0||end<=start||JSON.stringify(route.path)!==JSON.stringify(track.points.slice(start,end+1)))throw new Error('实测城市移动的线形与GPS窗口不一致：'+route.id);
  if(route.date&&times.slice(start,end+1).some(t=>cityDate(t,track.timeZone||'Asia/Tokyo')!==route.date))throw new Error('实测城市移动的日期与GPS窗口不一致：'+route.id);
  if(route.distanceType!=='observed'||route.durationType!=='observed'||Math.abs(route.km-(cumulative[end]-cumulative[start]))>.01||Math.abs(route.travelMinutes-(times[end]-times[start])/60)>.02)throw new Error('实测城市移动的公里或时长与GPS窗口不一致：'+route.id);
}

export const CITY_FILES=OPTIONAL_SOURCE_FILES;
export async function loadCityMapResources(c,{root=ROOT}={}){
  let geo;
  try{geo=await readJson(join(root,'data',c.boundaryFile));}
  catch(error){
    if(error.code!=='ENOENT')throw error;
    throw new Error(`城市${c.name}缺少行政边界资源 ${c.boundaryFile}；安装后重试：node scripts/fetch-city-geography.mjs ${c.id}`);
  }
  let context;
  try{context=await readJson(join(root,'data',c.contextFile));}
  catch(error){
    if(error.code!=='ENOENT')throw error;
    context={type:'FeatureCollection',features:[],source:'',unavailable:true};
  }
  if(c.landMaskFile)try{context.landMask=(await readJson(join(root,'data',c.landMaskFile))).geometry;}catch(error){if(error.code!=='ENOENT')throw error;}
  return {geo,context};
}
export async function loadCityDetails(folder,atlas,overrides={},source){
  let placeRows=overrides.cityPlaces;
  if(!placeRows)try{placeRows=parseCsv(await readFile(sourcePath(source||{type:'obsidian',folder},CITY_FILES[0]),'utf8'));}catch(e){if(e.code==='ENOENT')return {cities:{},scopes:[],geometries:{},contexts:{},report:{cities:0}};throw e;}
  if(!placeRows.length)return {cities:{},scopes:[],geometries:{},contexts:{},report:{cities:0}};
  const [catalog,moveText,tripRows,evidence]=await Promise.all([readJson(join(ROOT,'data/city-catalog.json')),overrides.cityMoves?null:readFile(sourcePath(source||{type:'obsidian',folder},CITY_FILES[1]),'utf8'),overrides.cityJourneys||readJson(sourcePath(source||{type:'obsidian',folder},CITY_FILES[2])),overrides.cityEvidence||readJson(sourcePath(source||{type:'obsidian',folder},CITY_FILES[3]))]);
  const moves=overrides.cityMoves||parseCsv(moveText),cities={},scopes=[],geometries={},contexts={},ids=new Set();
  for(const r of moves)if(!catalog.some(c=>c.id===r['城市编号']))throw new Error('城市移动未登记城市：'+r['移动编号']);
  for(const t of tripRows)if(!catalog.some(c=>c.id===t.cityId))throw new Error('城市行程未登记城市：'+t.id);
  for(const p of placeRows)if(!catalog.some(c=>c.id===p['城市编号']))throw new Error('未登记城市目录：'+p['城市编号']);
  if(new Set(moves.map(r=>r['移动编号'])).size!==moves.length)throw new Error('城市移动编号重复');
  if(new Set(tripRows.map(t=>t.id)).size!==tripRows.length)throw new Error('城市行程编号重复');
  for(const c of catalog){
    const owner=c.deriveFrom||c.id,rows=placeRows.filter(p=>p['城市编号']===owner),e=evidence[owner]||{};
    const hasEvidence=(e.tracks?.length||e.photoPoints?.length||e.stays?.length||e.summary?.footprintRows)>0;
    const globalPlaces=c.useGlobal?atlas.locationLayer.places.filter(p=>p.country===c.country&&p.include&&(!c.unitId||p.unitId===c.unitId)):[];
    // A newly registered city may have a complete observation layer before
    // any activity or place has been curated. Keep it navigable so curation
    // can happen incrementally instead of forcing a fake place row.
    if(!rows.length&&!hasEvidence&&(!c.useGlobal||!globalPlaces.length))continue;
    const {geo,context}=await loadCityMapResources(c);
    for(const f of geo.features){f.properties.name=c.names?.[f.properties.native]||f.properties.name;f.properties.english=String(f.properties.english||f.properties.name);}
    const trips=tripRows.filter(t=>t.cityId===owner),places=rows.map(p=>{
      const lat=numberOrNull(p['代表纬度']),lon=numberOrNull(p['代表经度']),id=p['地点编号'];
      if(!c.deriveFrom&&ids.has(id)||!id||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw new Error('城市地点身份或坐标无效：'+id);if(!c.deriveFrom)ids.add(id);
      if(!['已到访','交通节点','待核'].includes(p['到访状态'])||!['是','否'].includes(p['分享纳入'])||!p['核定依据']||!p['关联正文'])throw new Error('城市地点状态、分享或依据无效：'+id);
      const review=validatePlaceEvidence(p,{legacy:!atlas.meta.evidenceContractMigrated,city:true,allowHistoricalMigration:!!atlas.meta.evidenceContractMigrated});if(!review.ok)throw new Error('城市地点核定无效：'+id+'；'+review.errors.join('；'));
      if(p['节点级别']==='区域接续'&&p['到访状态']==='已到访')throw new Error('区域接续锚点不能激活旅游到访：'+id);
      const ward=geo.features.find(f=>pointInFeature([lon,lat],f));
      if(!c.deriveFrom&&p['行政区代码']&&p['行政区代码']!==ward?.id)throw new Error('城市地点行政区与坐标不符：'+id);
      const active=p['到访状态']==='已到访'&&p['分享纳入']!=='否'&&(!c.deriveFrom||!!ward);
      if(active&&!ward)throw new Error('城市到访点在行政边界之外：'+p['地点名称']);
      if(active&&c.mapBounds&&(lon<c.mapBounds[0]||lon>c.mapBounds[2]||lat<c.mapBounds[1]||lat>c.mapBounds[3]))throw new Error('城市游览窗口漏到访点，须扩大mapBounds：'+p['地点名称']);
      const parentId=p['上级地点编号'],parent=atlas.locationLayer.places.find(n=>n.id===parentId);if(!parent)throw new Error('城市地点缺少已有上级地点：'+id);
      if(ward&&(parent.country!==c.country||parent.unitId&&c.unitId&&parent.unitId!==c.unitId))throw new Error('城市地点上级身份与城市不一致：'+id);
      if(active&&parent.status!=='已到访')throw new Error('城市到访点不能由未核到访上级激活：'+id);
      const known=!ward&&atlas.locationLayer.places.find(n=>canonicalName(n.name,atlas.journeyLayer.aliases)===canonicalName(p['地点名称'],atlas.journeyLayer.aliases)&&greatCircleKm([lat,lon],[n.lat,n.lon])<150);
      return {id,name:p['地点名称'],lat,lon,country:known?.country||c.country,unitId:known?.unitId||c.unitId,cityId:ward?c.id:null,districtId:ward?.id||null,
        active,visited:active,parentId,level:p['节点级别']||'景区',first:p['最早线索日'],last:p['最晚线索日'],evidence:review.evidence};
    });
    if(c.useGlobal)for(const p of globalPlaces){
      const ward=p.country===c.country&&p.include&&geo.features.find(f=>pointInFeature([p.lon,p.lat],f));
      if(ward)places.push({id:p.id,name:p.name,country:p.country,unitId:p.unitId,lat:p.lat,lon:p.lon,level:p.level,first:p.first,last:p.last,cityId:c.id,districtId:ward.id,active:p.status==='已到访',visited:p.status==='已到访',parentId:p.id});
    }
    const index=new Map(places.map(p=>[p.id,p])),incidence=new Map(places.map(p=>[p.id,{in:0,out:0}]));
    const routes=moves.filter(r=>r['城市编号']===owner).map(r=>{
      const from=index.get(r['出发地点编号']),to=index.get(r['到达地点编号']);if(!from||!to||from.id===to.id)throw new Error('城市移动引用无效：'+r['移动编号']);
      incidence.get(from.id).out++;incidence.get(to.id).in++;
      const metadata=cityMovementMetadata(r,{legacy:!atlas.meta.evidenceContractMigrated});
      const trip=trips.find(t=>t.id===r['行程编号']);if(!trip)throw new Error('城市移动无所属行程：'+r['移动编号']);
      if(trip.parentPlaceId&&[from,to].some(p=>p.cityId===c.id&&p.parentId!==trip.parentPlaceId))throw new Error('城市到访实例上级身份与所属行程不一致：'+r['移动编号']);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(r['日期'])||r['日期']<trip.first||r['日期']>trip.last||!(Number(r['段序'])>0))throw new Error('城市移动日期或段序无效：'+r['移动编号']);
      const path=r['路线几何经纬']?JSON.parse(r['路线几何经纬']):null;
      if(path&&(!Array.isArray(path)||path.length<2||path.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>90)))throw new Error('城市路线几何无效：'+r['移动编号']);
      if(metadata.geometryType==='observed'&&(!path||!metadata.trackId||!(metadata.observedEnd>metadata.observedStart)))throw new Error('实测城市移动缺少轨迹身份和时间窗口：'+r['移动编号']);
      return {id:r['移动编号'],mode:r['交通方式'],...metadata,minutes:0,date:r['日期'],order:Number(r['段序']),tripId:r['行程编号'],nodes:[from,to],path};
    });
    const isolated=places.filter(p=>!c.useGlobal&&p.active&&(!incidence.get(p.id).in||!incidence.get(p.id).out));
    if(isolated.length)throw new Error('城市细地点缺少进入或离开移动：'+isolated.map(p=>p.name).join('、'));
    const visits=validateCityTripAccess(places,routes,trips);
    const units=geo.features.map(f=>({id:f.id,name:f.properties.name,english:f.properties.english,counted:!c.uncountedUnits?.includes(f.id.slice(c.id.length+1))})),scopeId='city:'+c.id;
    const coordinatesOf=f=>f.geometry.type==='Polygon'?f.geometry.coordinates.flat():f.geometry.coordinates.flat(2);
    const cityBounds=features=>boundsOf(features.flatMap(coordinatesOf).map(([lon,lat])=>[lat,lon]),0,0);
    scopes.push({id:scopeId,name:c.name,english:c.english,parent:c.parent,entryScopes:c.entryScopes,mapBounds:c.mapBounds,detailKind:c.detailKind,level:'city',movementCountLevel:c.entryScopes?.some(id=>id.startsWith('country:'))?'country':'city',cityId:c.id,countries:[c.country],units,bounds:cityBounds(geo.features),unitLabel:c.unitLabel||'到访行政区',source:c.source});
    for(const f of geo.features){
      scopes.push({id:'district:'+f.id,name:f.properties.name,english:f.properties.english,parent:scopeId,level:'district',cityId:c.id,districtId:f.id,countries:[c.country],units:[],bounds:cityBounds([f]),geometryParent:scopeId,unitLabel:'旅行地点',source:c.source});}
    geometries[scopeId]=geo;contexts[scopeId]=c.deriveFrom&&c.contextFile===catalog.find(n=>n.id===c.deriveFrom)?.contextFile?{ref:'city:'+c.deriveFrom}:context;
    for(const t of e.tracks||[])if(!/^\d{4}-\d{2}-\d{2}$/.test(t.date)||!Array.isArray(t.points)||t.points.length<2||t.points.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>90))throw new Error('城市定位轨迹格式无效：'+c.id);
    for(const p of e.photoPoints||[])if(!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||!Number.isFinite(p.lat)||!Number.isFinite(p.lon)||Math.abs(p.lat)>90||Math.abs(p.lon)>180)throw new Error('城市照片定位格式无效：'+c.id);
    for(const route of routes)validateObservedCityRoute(route,e);
    const combined=mergeDetailConnections(routes,atlasConnections(c,geo,atlas,places,{all:!!c.useGlobal}));
    if(c.useGlobal)for(const p of places.filter(p=>p.active)){
      const incoming=combined.some(r=>r.nodes.slice(1).some(n=>n.id===p.id)),outgoing=combined.some(r=>r.nodes.slice(0,-1).some(n=>n.id===p.id));
      if(!incoming||!outgoing)throw new Error('区域细化地点缺少接续：'+p.name);
    }
    const reconstruction=c.useGlobal?null:atlas.mobility?.reconstruction?projectMobility(atlas.mobility.reconstruction,c,geo,places):reconstructCity({config:c,geometry:geo,evidence:e,places});
    const inferredNodes=new Map(reconstruction?.nodes.map(n=>[n.id,n])||[]);
    const globalRoutes=new Map(atlas.routes.map(r=>[r.id,r]));
    const inferredRoutes=(reconstruction?.moves||[]).map(m=>({...m,...(globalRoutes.get('MOB-'+m.id)?.classificationRef?{mode:globalRoutes.get('MOB-'+m.id).mode,sourceMode:m.mode,vehicle:globalRoutes.get('MOB-'+m.id).vehicle}:{}),nodes:[inferredNodes.get(m.fromNodeId),inferredNodes.get(m.toNodeId)],minutes:0,reconstructed:true,
      travelDurationBasis:m.measurementBasis,distanceBasis:m.measurementBasis}));
    cities[c.id]={places,routes:combined,trips,visits,reconstruction,inferredRoutes,derived:!!c.deriveFrom,sourceCityId:owner,tracks:e.tracks||[],photoPoints:(e.photoPoints||[]).filter(p=>!c.deriveFrom||geo.features.some(f=>pointInFeature([p.lon,p.lat],f))),evidence:e.summary||{},parentPlaceIds:[...new Set(places.map(p=>p.parentId))]};
  }
  return {cities,scopes,geometries,contexts,report:{cities:Object.keys(cities).length,places:Object.values(cities).reduce((s,c)=>s+c.places.filter(p=>p.active).length,0),moves:Object.values(cities).reduce((s,c)=>s+c.routes.length,0)}};
}
