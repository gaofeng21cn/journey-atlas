import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import {parseCsv,csv} from './csv.mjs';
import { ROOT, readJson ,WORKSPACE_ROOT} from './data.mjs';
import { TABLES, SCHEMA_VERSION } from './schema.mjs';
import { REGION_PLACES, readRegionPlaces, regionView, regionRows } from './region-data.mjs';
import { JOURNEYS,TRAJECTORY,TRAJECTORY_HEADERS,locationLayer,journeyLayer,journeySummaryRows,improvementRows,trajectoryRows,trajectorySummary,routeTime,routePoints,routeNames,canonicalName,journeyContinuityRows } from './travel-layers.mjs';
import { HUB_LINKS,HUB_HEADERS,hubConnectors,hubRows } from './hub-links.mjs';
import {ACCESS,REFS,ACCESS_HEADERS,REF_HEADERS,transportNodeId,matchingPlaces,bindRouteNodes,attachAccess,accessRows,referenceRows} from './node-access.mjs';
import {createContinuityAudit,AUDIT_HEADERS} from './continuity-audit.mjs';
import {manifestFrom,manifestPath,runtimeManifest,sourceManifest} from './manifest.mjs';
import {validatePlaceEvidence,validateMovementEvidence} from './evidence-contract.mjs';
import {readVisitInstances,deriveVisitInstances,visitInstanceRows,visitInstanceSummary} from './visit-instances.mjs';
import {loadGlobalMobility,effectiveMobilityRoutes} from './global-mobility.mjs';
import {writeGlobalMobility} from './global-mobility-output.mjs';
import {isRecordedMovement,describeMovement,movementSummary} from '../src/route-semantics.mjs';
import {localEpoch} from './flight-time.mjs';
import {reconstructionProgress,connectionReconstructionRows} from './reconstruction-progress.mjs';
import { readAtlasConfig, resolveSource, sourcePath } from './source-data.mjs';

export { TABLES } from './schema.mjs';
export {parseCsv,csv} from './csv.mjs';

// Country intensity uses the same reconciled movement ledger as the passport.
// Transit/arrival mileage cannot activate a country or inflate local travel.
export function countryIntensity(countries,routes){
  const metrics=new Map(countries.map(c=>[c.name,{...c,meters:0,flightMeters:0,groundMeters:0,records:0}]));
  for(const r of routes){
    if(!isRecordedMovement(r)||r.countDistance===false||!Number.isFinite(r.km)||r.km<=0)continue;
    const names=[...new Set(r.countries||[])];
    if(names.length!==1||!metrics.has(names[0]))continue;
    const m=metrics.get(names[0]),meters=Math.round(r.km*1000);m.meters+=meters;m.records++;
    if(r.mode==='飞机')m.flightMeters+=meters;else m.groundMeters+=meters;
  }
  return [...metrics.values()].sort((a,b)=>b.meters-a.meters||a.name.localeCompare(b.name,'zh-CN')).map(({meters,flightMeters,groundMeters,...m})=>
    ({...m,km:meters/1000,flightKm:flightMeters/1000,groundKm:groundMeters/1000}));
}
const num = x => x == null || String(x).trim() === '' ? null : Number(x);
const validPoint = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;

export function distanceKm(points, method) {
  const factor = { rail: 1.2, road: 1.25, sea: 1.05, cable: 1.05, mountain: 1.35 }[method];
  if (!factor) return null;
  if (!points.every(validPoint)) throw new Error('交通坐标超出范围');
  let km = 0;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]].map(p => p.map(v => v * Math.PI / 180));
    const h = Math.sin((b[0] - a[0]) / 2) ** 2 + Math.cos(a[0]) * Math.cos(b[0]) * Math.sin((b[1] - a[1]) / 2) ** 2;
    km += 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
  }
  return Math.round(km * factor);
}

export function readGround(rows,placeIndex=new Map(),{allowLegacyRefs=true,legacy=true}={}) {
  const ids = new Set(), fingerprints = new Set();
  return rows.map(r => {
    if (!r['交通编号'] || ids.has(r['交通编号'])) throw new Error(`交通编号为空或重复：${r['交通编号']}`);
    ids.add(r['交通编号']);
    const controlled=['接驳段','资料间隔','节点对应'].includes(r['记录类型']);
    if(!r['日期或区间']||!r['关联正文']||!r['发生依据']||!r['发生状态'])throw new Error(`交通记录缺日期、依据或正文：${r['交通编号']}`);
    if(!['飞机','铁路','公路','步行','轮渡','缆车','山地交通','地面交通','地面交通待定','交通方式待定'].includes(r['交通方式']))throw new Error(`交通方式未登记：${r['交通编号']}`);
    const review=validateMovementEvidence(r,{legacy,allowHistoricalMigration:!legacy});
    if(!review.ok)throw new Error(`交通核定合同无效：${r['交通编号']} / ${review.errors.join('；')}`);
    const nodeIds=(r['节点编号序列']||'').split('；').filter(Boolean);
    const nodePlaceIds=(r['地点编号序列']||'').split('；').filter(Boolean);
    if(!nodeIds.length&&!nodePlaceIds.length&&!allowLegacyRefs)throw new Error('交通必须填写节点编号序列或地点编号序列：'+r['交通编号']);
    const linked=nodePlaceIds.map(id=>{const p=placeIndex.get(id);if(!p)throw new Error('交通关联地点不存在：'+r['交通编号']+' / '+id);return p;});
    const unified=nodeIds.map(id=>placeIndex.get(id));
    const points = nodeIds.length?(r['坐标序列纬经']?JSON.parse(r['坐标序列纬经']):unified.map(p=>[p?.lat,p?.lon])):linked.length?linked.map(p=>[p.lat,p.lon]):JSON.parse(r['坐标序列纬经']);
    const names = nodeIds.length?(r['途经节点']?r['途经节点'].split('；'):unified.map(p=>p?.name)):linked.length?linked.map(p=>p.name):r['途经节点'].split('；');
    if (names.length < 2 || names.length !== points.length || !points.every(validPoint)) throw new Error(`交通节点或坐标无效：${r['交通编号']}`);
    const countries=(r['国家地区']||'').split('；').filter(Boolean);
    if(nodeIds.length){
      if(nodeIds.length!==points.length)throw new Error('节点编号须与路线节点一一对应：'+r['交通编号']);
      nodeIds.forEach((id,i)=>{
        const p=placeIndex.get(id);
        if(p){
          if(!matchingPlaces(names[i],points[i],countries,[p],{ground:true}).length)throw new Error('节点编号与地名、国家或坐标不一致：'+r['交通编号']+' / '+id);
        }else if(!controlled&&id!==transportNodeId(names[i],points[i],countries.join('；')))throw new Error('交通节点编号不存在或身份不一致：'+r['交通编号']+' / '+id);
      });
      if(nodePlaceIds.length&&nodePlaceIds.join('；')!==nodeIds.join('；'))throw new Error('两套节点编号冲突：'+r['交通编号']);
    }else if(linked.length&&r['途经节点']&&r['途经节点'].split('；').some((n,i)=>n!==linked[i]?.name))throw new Error('地点编号与展示地名不一致：'+r['交通编号']);
    const model=r['距离模型']||'',manualKm=num(r['里程公里']);
    const models={rail:'铁路',road:'公路',sea:'轮渡',cable:'缆车',mountain:'山地交通'};
    if(model&&(!linked.length||models[model]!==r['交通方式']||manualKm!==null))throw new Error('距离模型须对应方式、引用地点且不同时填手工公里：'+r['交通编号']);
    const km=model?distanceKm(points,model):manualKm;
    const basis=model?`地点层代表坐标分段大圆距离×${{rail:1.2,road:1.25,sea:1.05,cable:1.05,mountain:1.35}[model]}（${r['交通方式']}估算）`:r['里程依据'];
    if (km !== null && (!Number.isFinite(km) || km <= 0 || !basis)) throw new Error(`交通公里须为正数且有依据，未知留空：${r['交通编号']}`);
    if (r['交通方式'] === '地面交通待定' && km !== null && !String(basis || '').startsWith('合理占位估算')) {
      throw new Error(`方式未核的公里必须标为合理占位估算：${r['交通编号']}`);
    }
    const minutes=num(r['飞行时长分钟']);
    if(minutes!==null&&(r['交通方式']!=='飞机'||!Number.isFinite(minutes)||minutes<=0||!r['飞行时长依据']))throw new Error(`补充飞行时长无效或缺依据：${r['交通编号']}`);
    const travelMinutes=num(r['交通时长分钟']);
    if(travelMinutes!==null&&(!Number.isFinite(travelMinutes)||travelMinutes<=0||!r['交通时长依据']))throw new Error(`交通时长须为正数且有依据：${r['交通编号']}`);
    if(r['交通方式']==='飞机'&&minutes!==null&&travelMinutes!==null&&minutes!==travelMinutes)throw new Error(`两套飞行时长冲突：${r['交通编号']}`);
    // Both source spellings describe one flight duration. Normalize them once
    // at the source boundary so atlas, regional views and flight cards cannot
    // select different values. Original table columns stay untouched.
    const isFlight=r['交通方式']==='飞机',flightMinutes=minutes??travelMinutes;
    const flightDurationBasis=minutes!==null?r['飞行时长依据']:r['交通时长依据']||r['飞行时长依据']||'';
    const fingerprint = [r['日期或区间'], r['交通方式'], linked.length?nodePlaceIds.join('；'):names.join('；'),controlled?[r['前序交通编号'],r['前序路线段'],r['后序交通编号'],r['后序路线段']].join('→'):''].join('|');
    if (fingerprints.has(fingerprint)) throw new Error(`同日同方式同路线重复：${r['交通编号']}`);
    fingerprints.add(fingerprint);
    if (!['纳入','排除'].includes(r['分享纳入'])) throw new Error(`分享纳入须为纳入或排除：${r['交通编号']}`);
    if(r['记录类型']&&!['旅行航段','接驳段','资料间隔','节点对应'].includes(r['记录类型']))throw new Error('交通记录类型无效：'+r['交通编号']);
    if(controlled&&(!r['前序交通编号']||!r['后序交通编号']||![r['前序路线段'],r['后序路线段']].every(v=>Number.isInteger(Number(v))&&Number(v)>0)))throw new Error('接续须绑定前后交通及正整数路线段：'+r['交通编号']);
    const typed=['计程纳入','里程类型','时长类型','线形类型'].some(k=>String(r[k]||'').trim());
    const metricTypes=['observed','archived','reference','model','unknown'];
    if(typed&&(!['是','否'].includes(r['计程纳入'])||!metricTypes.includes(r['里程类型'])||!metricTypes.includes(r['时长类型'])||![...metricTypes,'display'].includes(r['线形类型'])))throw new Error('交通数值来源类型不完整：'+r['交通编号']);
    const structuralLink=controlled&&r['计程纳入']==='否'&&r['发生状态']==='待还原';
    if(review.evidence.conclusion==='待核'&&r['计程纳入']!=='否')throw new Error('待核交通不能计程：'+r['交通编号']);
    if(structuralLink&&(km!==null||minutes!==null||travelMinutes!==null||model||r['里程类型']!=='unknown'||r['时长类型']!=='unknown'||review.evidence.conclusion!=='待核'))throw new Error('未知接续不能声明已发生或计入距离、时长：'+r['交通编号']);
    if(r['分享纳入']!=='排除'&&r['记录类型']==='资料间隔'&&(!structuralLink||nodeIds.length!==2||nodeIds[0]!==nodeIds[1]))throw new Error('资料间隔只记录同节点观测之间未知区间：'+r['交通编号']);
    if(r['记录类型']==='节点对应'&&(r['计程纳入']!=='否'||km!==null||minutes!==null||travelMinutes!==null||!['已发生','合理重构'].includes(review.evidence.conclusion)))throw new Error('节点对应须明确核定身份关系且不计量：'+r['交通编号']);
    if(!countries.length) countries.push(...new Set(linked.map(p=>p.country)));
    if(!countries.length)throw new Error('交通缺国家归属：'+r['交通编号']);
    return { id: r['交通编号'], date: r['日期或区间'], mode: r['交通方式'], vehicle:r['交通工具']||'', names, points, km,
      countries, source: r['关联正文'], evidence: r['发生依据'],
      status: r['发生状态'], distanceBasis: basis, include: r['分享纳入'] === '纳入',nodePlaceIds,distanceModel:model,
      minutes:isFlight?flightMinutes:minutes,durationBasis:isFlight?flightDurationBasis:r['飞行时长依据']||'',
      travelMinutes:isFlight?flightMinutes:travelMinutes,travelDurationBasis:isFlight?flightDurationBasis:r['交通时长依据']||'',nodeIds:nodeIds.length?nodeIds:nodePlaceIds,
      recordType:r['记录类型']||'旅行航段',previousTransport:r['前序交通编号']||'',nextTransport:r['后序交通编号']||'',
      previousSegment:r['前序路线段']?Number(r['前序路线段']):null,nextSegment:r['后序路线段']?Number(r['后序路线段']):null,
      countDistance:r['计程纳入']!=='否',countDuration:r['计程纳入']!=='否',
      metricOwnerIds:(r['被覆盖交通段']||'').split('；').filter(Boolean),
      distanceType:r['里程类型']||'unknown',durationType:r['时长类型']||'unknown',geometryType:r['线形类型']||'display',
      review:review.evidence,structuralLink,
      ...routeTime(r) };
  });
}

export function readPlaces(rows, prefectures,{legacy=true}={}) {
  const ids = new Set(),names=new Set();
  const allowed = new Set(prefectures.map(p => p[0]));
  return rows.map(r => {
    if (!r['地点编号'] || ids.has(r['地点编号'])) throw new Error(`日本地点编号重复或为空：${r['地点编号']}`);
    ids.add(r['地点编号']);
    if(!r['城市/城镇']||names.has(r['都道府县代码']+'|'+r['城市/城镇']))throw new Error(`日本地点为空或重复：${r['地点编号']}`);
    names.add(r['都道府县代码']+'|'+r['城市/城镇']);
    const id = r['都道府县代码'].padStart(2, '0');
    if (!allowed.has(id)) throw new Error(`未知都道府县代码：${id}`);
    if (!['已到访','途经/机场','待核'].includes(r['到访状态'])) throw new Error(`日本地点状态无效：${r['地点编号']}`);
    if(r['分享纳入']&&!['纳入','排除'].includes(r['分享纳入']))throw new Error('日本地点分享纳入无效：'+r['地点编号']);
    if (r['到访状态'] === '已到访' && (!r['核定依据'] || !r['关联正文'])) throw new Error(`到访缺少依据或正文：${r['地点编号']}`);
    const review=validatePlaceEvidence(r,{legacy,allowHistoricalMigration:!legacy});if(!review.ok)throw new Error('日本地点核定合同无效：'+r['地点编号']+' / '+review.errors.join('；'));
    const lat = num(r['代表纬度']), lon = num(r['代表经度']);
    if ((lat===null)!==(lon===null)||(lat !== null && !validPoint([lat, lon]))) throw new Error(`日本地点坐标无效：${r['地点编号']}`);
    return { id: r['地点编号'], name: r['城市/城镇'], original:r['原地名']||'', originalNames:String(r['原地名']||'').split('；').filter(Boolean), prefectureId: id, status: r['到访状态'],
      lat, lon, first: r['最早线索日'], last: r['最晚线索日'], source: r['关联正文'], evidence: r['核定依据'],review:review.evidence,include:r['分享纳入']!=='排除',level:r['节点级别']||'',parentId:r['上级节点编号']||'',transportAccess:r['交通接入确认']||'',transportAccessFrom:r['交通接入起始日期']||'',transportAccessTo:r['交通接入结束日期']||'',groundNames:(r['地面节点关联']||'').split('；').filter(Boolean) };
  });
}

export function aggregatePrefectures(prefectures, places) {
  return prefectures.map(([id, name, native, region]) => {
    const all = places.filter(p => p.prefectureId === id);
    const visited = all.filter(p => p.status === '已到访'&&p.include!==false);
    const dates = all.flatMap(p => [p.first,p.last]).filter(Boolean).sort();
    return { id, name, native, region, visited: visited.length > 0,
      status: visited.length ? '已到访' : all.length ? '有线索待核' : '暂无到访证据',
      cities: visited.map(p => p.name), candidates: all.length,
      first: dates[0] || '', last: dates.at(-1) || '',
      sources: [...new Set(visited.flatMap(p => p.source.split('；')))].filter(Boolean) };
  });
}

// Only these already-reviewed source bases have a known legacy metric type.
// Ticket usage proves occurrence, never an actual flight path or airborne time.
const legacyFlightDistanceTypes=new Map([
  ['航旅纵横导出原值优先','archived'],['航旅纵横导出原值；计划不计已完成','archived'],
  ['无导出值；采用公开机场对参考距离，路线/机场/日期仍为补录证据精度','reference'],
  ['合理占位：两端机场代表坐标大圆估算，沿用本行里程公里；历史机场对暂缺公开参考，获得票据或公开值后按原编号修正','model'],
]);
const legacyFlightDurationTypes=new Map([
  ['表列当地起降时刻，按机场历史时区与跨日换算；非实际空中时间','archived'],
  ['已记录航班的里程—时长线性模型估算','model'],['已记录同向航线时长中位数估算','model'],
]);
export function flightsFromArchive(rows,{legacy=true}={}) {
  const ids = new Set();
  return rows.map(r => {
    if (!r['证据编号'] || ids.has(r['证据编号'])) throw new Error('航段证据编号重复或为空');
    ids.add(r['证据编号']);
    const km = num(r['统计采用里程公里']);
    const minutes=num(r['飞行时长分钟']);
    const points = [[num(r['纬度_出发']),num(r['经度_出发'])], [num(r['纬度_到达']),num(r['经度_到达'])]];
    if (!points.every(validPoint)) throw new Error(`航段坐标无效：${r['证据编号']}`);
    if (km !== null && (!Number.isFinite(km) || km <= 0)) throw new Error(`航段统计公里无效：${r['证据编号']}`);
    if(minutes!==null&&(!Number.isFinite(minutes)||minutes<=0))throw new Error('航段时长无效：'+r['证据编号']);
    const review=validateMovementEvidence({...r,'发生依据':r['航段发生依据']},{legacy});
    if(!review.ok)throw new Error('航空核定合同无效：'+r['证据编号']+' / '+review.errors.join('；'));
    if(r['时刻使用策略']&&!['原始记录','仅日期'].includes(r['时刻使用策略']))throw new Error('航空时刻使用策略无效：'+r['证据编号']);
    const typed=['计程纳入','里程类型','时长类型','线形类型'].some(k=>String(r[k]||'').trim());
    const types=['observed','archived','reference','model','unknown'];
    if(typed&&(!['是','否'].includes(r['计程纳入'])||!types.includes(r['里程类型'])||!types.includes(r['时长类型'])||![...types,'display'].includes(r['线形类型'])))throw new Error('航空数值来源类型不完整：'+r['证据编号']);
    if((typed||!review.evidence.legacy)&&(km!==null&&!r['统计里程依据']||minutes!==null&&!r['飞行时长依据']))throw new Error('航空数值缺来源依据：'+r['证据编号']);
    if(review.evidence.conclusion==='待核'&&r['计程纳入']!=='否')throw new Error('待核航空不能计程：'+r['证据编号']);
    return { id: r['证据编号'], date: r['日期标准'] || r['日期'], mode: '飞机',airline:r['航空公司']||'',flightNo:r['航班号']||'',
      scheduledStart:r['时刻使用策略']==='仅日期'?null:localEpoch(r['日期标准'],r['出发时间'],r['出发时区']),
      scheduledEnd:r['时刻使用策略']==='仅日期'?null:localEpoch(String(r['到达日期推算']||r['日期标准']).slice(0,10),r['到达时间'],r['到达时区']),
      names: [r['出发城市'],r['到达城市']], cities: [r['出发服务城市'],r['到达服务城市']], points,
      countries: [r['出发国家地区'],r['到达国家地区']], km,
      minutes, status: r['记录类型'],recordType:'旅行航段',
      distanceBasis: r['统计里程依据'], durationBasis:r['飞行时长依据'], evidence:r['航段发生依据'],source: r['关联正文'], include:review.evidence.conclusion!=='排除',
      countDistance:r['计程纳入']!=='否',countDuration:r['计程纳入']!=='否',
      distanceType:r['里程类型']||legacyFlightDistanceTypes.get(r['统计里程依据'])||'unknown',
      durationType:r['时长类型']||legacyFlightDurationTypes.get(r['飞行时长依据'])||'unknown',geometryType:r['线形类型']||'display',review:review.evidence,
      ...routeTime({date:r['日期标准']||r['日期']}) };
  });
}

export function buildAtlas({ flights, ground, places, prefectures, countryFlags }) {
  // Exactly one owner per flight: additional flights need a distinct source/date/endpoints.
  const fKeys = new Set(flights.map(f => `${f.date}|${f.points.map(p => p.join(',')).join('|')}`));
  const active = ground.filter(g => g.include);
  for (const g of active.filter(g => g.mode === '飞机')) {
    if (fKeys.has(`${g.date}|${g.points.map(p => p.join(',')).join('|')}`)) throw new Error(`补充飞机与客票重叠：${g.id}`);
  }
  const routes = [...flights, ...active];
  const allCountries = [...new Set(routes.flatMap(r => r.countries).filter(Boolean))];
  // Include ground-only countries from the approved poster country inventory, preserving
  // the user's all-itinerary sharing scope. This is coverage, not a ground-entry claim.
  for (const c of countryFlags) if (!allCountries.includes(c.name)) allCountries.push(c.name);
  const visitedPlaces = places.filter(p => p.status === '已到访'&&p.include!==false);
  const pref = aggregatePrefectures(prefectures, places);
  const byMode = Object.fromEntries(['飞机','铁路','公路','步行','轮渡','缆车','山地交通','地面交通','市内交通','地面交通待定','交通方式待定'].map(mode => {
    const selected = routes.filter(r => r.mode === mode&&r.countDistance!==false);
    return [mode, { records: selected.length, km: selected.reduce((s,r) => s + (r.km ?? 0),0), missingKm: selected.filter(r => r.km === null).length }];
  }));
  const nodeMap = new Map();
  for (const r of routes.filter(r=>r.recordType!=='节点对应')) routeNames(r).forEach((name,i) => {
    const point=routePoints(r)[i];
    const key = point.map(v => v.toFixed(2)).join(',');
    const old = nodeMap.get(key);
    nodeMap.set(key, { name, lat: point[0], lon: point[1], n: (old?.n || 0)+1 });
  });
  const domestic = routes.filter(r => r.countries.every(c => c === '日本'));
  const years = routes.flatMap(r => [...r.date.matchAll(/(?:19|20)\d{2}/g)].map(m => Number(m[0])));
  const japanYears = visitedPlaces.flatMap(p => [p.first,p.last]).filter(Boolean).map(d => Number(d.slice(0,4))).filter(Number.isFinite);
  return {
    meta: { schemaVersion: SCHEMA_VERSION, totalKm: routes.filter(r=>r.countDistance!==false).reduce((s,r) => s + (r.km ?? 0),0), flightKm: byMode['飞机'].km,
      groundKm: Object.entries(byMode).filter(([k]) => k !== '飞机').reduce((s,[,v]) => s+v.km,0),
      flightMinutes: routes.filter(r=>r.mode==='飞机'&&r.countDuration!==false).reduce((s,r) => s+(r.minutes ?? 0),0), flightCount: byMode['飞机'].records,
      groundCount: active.filter(r => r.mode !== '飞机'&&r.countDistance!==false).length, routes: routes.filter(isRecordedMovement).length, nodes: nodeMap.size,
      countries: allCountries.length, missingKm: routes.filter(r => r.km === null&&r.countDistance!==false).length,
      firstYear: years.length?Math.min(...years):null, lastYear: years.length?Math.max(...years):null, earthKm: 40075 },
    japan: { visited: pref.filter(p => p.visited).length, total: 47, cities: visitedPlaces.length,
      km: domestic.filter(r=>r.countDistance!==false).reduce((s,r) => s+(r.km ?? 0),0), routes: domestic.length,
      groundKm: domestic.filter(r => r.mode !== '飞机').reduce((s,r) => s+(r.km ?? 0),0),
      firstYear: japanYears.length?Math.min(...japanYears):null, lastYear: japanYears.length?Math.max(...japanYears):null,
      regions: new Set(pref.filter(p => p.visited).map(p => p.region)).size },
    countries: allCountries.map(name => ({ name, flag: countryFlags.find(c => c.name === name)?.flag || '' })),
    routes, nodes: [...nodeMap.values()], byMode, places, prefectures: pref,
  };
}

export async function loadAtlas(vault, overrides={}, {allowLegacyRefs=false,validateDates=true,allowStaleConnections=false,source:sourceOverride,config:configOverride}={}) {
  const config=configOverride||await readAtlasConfig();
  const source=await resolveSource({vault,config,source:sourceOverride});
  const folder=source.folder;
  const [flightRows, groundRows, placeRows, pref,catalog,regionalRows,jRows,visitRows] = await Promise.all([
    overrides.flightArchive||readFile(sourcePath(source,TABLES.flightArchive),'utf8').then(parseCsv),
    overrides.ground||readFile(sourcePath(source,TABLES.ground),'utf8').then(parseCsv),
    overrides.japanPlaces||readFile(sourcePath(source,TABLES.places),'utf8').then(parseCsv),
    readJson(join(ROOT,'data/japan-prefectures.json')),readJson(join(ROOT,'data/region-catalog.json')),
    overrides.regionPlaces||readFile(sourcePath(source,REGION_PLACES),'utf8').then(parseCsv),
    overrides.journeys||readFile(sourcePath(source,JOURNEYS),'utf8').then(parseCsv),
    overrides.visits||readFile(sourcePath(source,TABLES.visits),'utf8').then(parseCsv).catch(e=>{if(e.code==='ENOENT')return [];throw e;}),
  ]);
  const legacy=visitRows.length===0;
  const japanese=readPlaces(placeRows,pref,{legacy}),regionalPlaces=readRegionPlaces(regionalRows,catalog,{legacy});
  const locations=locationLayer(japanese,regionalPlaces),flights=flightsFromArchive(flightRows),ground=readGround(groundRows,locations.index,{allowLegacyRefs,legacy});
  const bound=bindRouteNodes([...flights,...ground],locations);
  const itineraries=journeyLayer(jRows,bound.filter(r=>!['接驳段','资料间隔','节点对应'].includes(r.recordType)),locations,{validateDates});
  const managed=bound.filter(r=>['接驳段','资料间隔','节点对应'].includes(r.recordType));
  const ordinaryIndex=new Map(bound.filter(r=>!['接驳段','资料间隔','节点对应'].includes(r.recordType)).map(r=>[r.id,r]));
  for(const r of managed){
    if(!r.include)continue;
    const previous=ordinaryIndex.get(r.previousTransport),next=ordinaryIndex.get(r.nextTransport);
    const endpoints=[previous?.nodeRefs?.[r.previousSegment],next?.nodeRefs?.[r.nextSegment-1]];
    if(r.points.length!==2||endpoints.some((n,i)=>!n||n.id!==r.nodeIds[i]||JSON.stringify(n.point)!==JSON.stringify(r.points[i])||n.name!==r.names[i]))throw new Error('维护接续与前后原始交通端点不一致：'+r.id+' / '+JSON.stringify({expected:endpoints.map(n=>n&&({id:n.id,point:n.point,name:n.name})),actual:r.nodeRefs.map(n=>({id:n.id,point:n.point,name:n.name}))}));
    // The union of countries is not a positional array. Keep each endpoint's
    // country from the exact source leg, not the other endpoint's departure.
    r.nodeRefs=r.nodeRefs.map((n,i)=>({...n,country:endpoints[i].country}));
    r.countries=[...new Set(endpoints.map(n=>n.country).filter(Boolean))];
  }
  itineraries.routes.push(...managed.filter(r=>r.include&&r.recordType!=='资料间隔'));
  const flags=overrides.coverage||config.coverage;
  if(!Array.isArray(flags))throw new Error('缺少独立分享范围配置；请在 data/atlas-config.json 中补充 coverage 数组');
  const activeIds=new Set(itineraries.routes.map(r=>r.id));
  const atlas = buildAtlas({flights:flights.filter(r=>activeIds.has(r.id)),ground:ground.map(r=>({...r,include:activeIds.has(r.id)})),places:japanese,prefectures:pref,countryFlags:flags});
  atlas.routes=itineraries.routes;
  // Flags are display assets, never evidence of a country visit. Airport-only
  // destinations stay in the movement graph without activating travel coverage.
  const countries=new Map();
  for(const p of locations.places.filter(p=>p.include&&(p.status==='已到访'||p.status==='计划'&&catalog.europe.countries.includes(p.country)&&catalog.europe.includePlans))){
    if(!countries.has(p.country))countries.set(p.country,{name:p.country,flag:flags.find(c=>c.name===p.country)?.flag||[...p.countryCode].map(c=>String.fromCodePoint(127397+c.charCodeAt(0))).join('')});
  }
  atlas.countries=[...countries.values()];atlas.meta.countries=atlas.countries.length;
  atlas.locationLayer={places:locations.places,byName:locations.byName,uniqueByName:locations.uniqueByName,resolveName:locations.resolveName,summary:locations.summary};
  atlas.journeyLayer={journeys:itineraries.journeys,aliases:itineraries.aliases,summary:itineraries.summary,unassigned:itineraries.unassigned.map(r=>r.id)};
  atlas.journeySummaries=journeySummaryRows(itineraries);
  const aliases=itineraries.aliases;
  // Propose gaps from actual travel only. Re-reading a managed LINK as the
  // preceding trip would create a new candidate around the candidate itself.
  const draft=trajectoryRows(itineraries.routes.filter(r=>!r.structuralLink),itineraries.journeys,{aliases,allowStaleBindings:allowStaleConnections});
  atlas.hubLinks=hubConnectors(draft,itineraries.routes,{managed});
  atlas.trajectory=trajectoryRows([...itineraries.routes,...managed.filter(r=>r.include&&r.recordType==='资料间隔')],itineraries.journeys,{aliases,connectors:atlas.hubLinks,allowStaleBindings:allowStaleConnections});
  atlas.trajectorySummary=trajectorySummary(atlas.trajectory);
  atlas.journeyContinuity=journeyContinuityRows(atlas);
  // 整条路线的相邻比较不能描述插入中途支线后的轨迹；阅读表与实际
  // 城市轨迹保持同一口径，原比较结果保留作排序复核线索。
  atlas.journeySummaries=atlas.journeySummaries.map(j=>{
    const id=j['行程编号'],closure=atlas.journeyContinuity.find(c=>c['行程编号'].split('；').includes(id));
    const actualGaps=atlas.trajectory.filter(t=>t['所属行程编号']===id&&t['接续状态']==='断点');
    const links=atlas.hubLinks.filter(c=>c.previousJourney===id||c.nextJourney===id);
    return {...j,'排序复核提示':j['接续待核'],'接续待核':actualGaps.map(t=>t['接续说明']).join('；'),
      '闭环状态':closure?.['闭环状态']||'','接续已覆盖':links.map(c=>`${c.id} ${c.fromName}→${c.toName}`).join('；')};
  });
  // Candidate connections remain visible, but never prove a visit or contribute
  // distance. Only maintained movements participate in visit-instance access.
  const connectorRecords=atlas.hubLinks.map(c=>{
    const refs=[c.fromName,c.toName].map((name,i)=>{
      const point=i?c.to:c.from,placeId=i?c.toPlaceId:c.fromPlaceId,p=locations.index.get(placeId);
      return {id:(i?c.toNodeId:c.fromNodeId)||transportNodeId(name,point),placeId:p?.id||'',servicePlaceId:'',name,point,
        type:p?'地点':'交通节点',country:p?.country||'',reason:'必要接续待还原'};
    });
    return {id:c.id,include:true,candidate:true,countDistance:false,countDuration:false,km:null,date:c.date,startDate:c.startDate,endDate:c.endDate,
      nodeRefs:refs,nodeIds:refs.map(n=>n.id),nodePlaceIds:refs.map(n=>n.placeId),points:[c.from,c.to],names:[c.fromName,c.toName],source:c.source,journeyId:c.nextJourney};
  });
  atlas.managedConnections=managed;
  atlas.connectionIntervals=managed.filter(r=>r.include&&r.recordType==='资料间隔');
  const visitContext={places:locations.places,routes:itineraries.routes,journeys:itineraries.journeys,connectors:managed};
  atlas.visitInstances=visitRows.length?readVisitInstances(visitRows,visitContext):deriveVisitInstances(visitContext);
  atlas.visitInstanceSummary=visitInstanceSummary(atlas.visitInstances);
  atlas.meta.evidenceContractMigrated=!legacy;
  attachAccess(locations,itineraries.routes,{visitInstances:atlas.visitInstances});
  atlas.locationLayer.places=locations.places;
  atlas.locationLayer.summary=locations.summary;
  // Maintained connectors already belong to atlas.routes. Derived candidates
  // carry no mode/distance, so they cannot silently change any statistic.
  atlas.meta.hubKm=0;
  atlas.meta.hubLinks=atlas.hubLinks.length;
  atlas.meta.hubFlownKm=0;
  atlas.meta.hubGroundKm=0;
  atlas.meta.unrestoredConnections=atlas.hubLinks.length+managed.filter(r=>r.include&&r.structuralLink&&r.recordType==='接驳段').length;
  atlas.meta.observationIntervals=atlas.connectionIntervals.length;
  atlas.improvements=improvementRows(atlas);
  atlas.nodeReferences=referenceRows([...itineraries.routes,...atlas.connectionIntervals,...connectorRecords]);
  atlas.nodeReferenceSummary={routes:itineraries.routes.length,
    explicitRoutes:itineraries.routes.filter(r=>r.nodePlaceIds?.length===r.points.length).length,
    transportNodeRoutes:itineraries.routes.filter(r=>r.nodeRefs?.some(n=>n.type==='交通节点')).length,
    unresolvedRoutes:itineraries.routes.filter(r=>r.nodeRefs?.some(n=>n.reason==='名称无法唯一匹配')).length,
    references:atlas.nodeReferences.length};
  const mobility=overrides.globalMobility===false?null:await loadGlobalMobility(folder,atlas,source);
  if(mobility){
    atlas.referenceRoutes=atlas.routes;
    atlas.mobility=mobility;atlas.routes=effectiveMobilityRoutes(mobility);
    atlas.meta.referenceTotalKm=atlas.meta.totalKm;atlas.meta.totalKm=Math.round(mobility.summary.totalKm);atlas.meta.totalMeters=Math.round(mobility.summary.totalKm*1000);
    atlas.meta.groundKm=atlas.meta.totalKm-atlas.meta.flightKm;atlas.meta.mobility=mobility.summary;atlas.meta.movementScope='全部移动，包含日常通勤';
    atlas.meta.routes=atlas.routes.filter(isRecordedMovement).length;atlas.meta.groundCount=atlas.routes.filter(r=>r.mode!=='飞机'&&isRecordedMovement(r)&&r.countDistance!==false).length;
    const domestic=atlas.routes.filter(r=>r.countries.every(c=>c==='日本'));
    atlas.japan.km=Math.round(domestic.filter(r=>r.countDistance!==false).reduce((s,r)=>s+(r.km??0),0));
    atlas.japan.groundKm=Math.round(domestic.filter(r=>r.mode!=='飞机'&&r.countDistance!==false).reduce((s,r)=>s+(r.km??0),0));
  }
  const placeIndex=new Map(locations.places.map(p=>[p.id,p]));
  const cityKey=id=>{let p=placeIndex.get(id);const seen=new Set();while(p&&!seen.has(p.id)){seen.add(p.id);if(p.level==='城市/城镇')return p.country+'|'+canonicalName(p.name,aliases).replace(/市$/,'');p=placeIndex.get(p.parentId);}return '';};
  atlas.routes=atlas.routes.map(r=>describeMovement({...r,cityKeys:r.nodes?.map(n=>n.cityKey||'')||r.nodeRefs?.map((n,i)=>cityKey(n.placeId||n.servicePlaceId)||(r.cities?.[i]?(r.countries.length===1?r.countries[0]:r.countries[i])+'|'+canonicalName(r.cities[i],aliases).replace(/市$/,''):''))}));
  const routeIndex=new Map(atlas.routes.map(r=>[r.id,r]));
  const claimedOwners=new Set();
  for(const r of atlas.routes.filter(r=>r.metricOwnerIds?.length)){
    if(r.countDistance!==false||r.countDuration!==false)throw new Error('被覆盖移动不能再次计量：'+r.id);
    for(const id of r.metricOwnerIds){const owner=routeIndex.get(id);
      if(!isRecordedMovement(owner)||owner.countDistance===false||!owner.startDate||!owner.endDate||owner.startDate<r.startDate||owner.endDate>r.endDate||owner.countries.some(c=>!r.countries.includes(c))||claimedOwners.has(id))throw new Error('计量归属无效或日期不一致：'+r.id+' / '+id);
      claimedOwners.add(id);
      // Reviewed transport detail applies to this exact physical movement,
      // while the observation model continues to own distance and duration.
      Object.assign(owner,{mode:r.mode,vehicle:r.vehicle,classificationRef:r.id});
    }
  }
  atlas.meta.routes=atlas.routes.filter(isRecordedMovement).length;
  atlas.movement=movementSummary(atlas.routes);
  atlas.byMode=Object.fromEntries(atlas.movement.modes.map(m=>[m.mode,{records:m.records,km:m.km,missingKm:atlas.routes.filter(r=>isRecordedMovement(r)&&r.mode===m.mode&&r.countDistance!==false&&r.km==null).length}]));
  atlas.meta.transportMoves=atlas.movement.displayMoves;
  atlas.meta.walkingMoves=atlas.movement.walkingMoves;
  atlas.countries=countryIntensity(atlas.countries,atlas.routes);
  atlas.meta.countryOrder='internal-distance-desc';
  atlas.regions=Object.fromEntries(Object.entries(catalog).map(([key,config])=>[key,regionView(config,regionalPlaces,atlas.routes,{coverage:atlas.countries.map(c=>({...c,n:1}))})]));
  return { atlas, folder, vault: source.base, source, sourceRows:{flightArchive:flightRows,japanPlaces:placeRows,regionPlaces:regionalRows,ground:groundRows,journeys:jRows,visits:visitRows} };
}

export const prefectureRows = atlas => atlas.prefectures.map(p => ({
  '都道府县代码': p.id, '中文名称': p.name, '当地名称': p.native, '地区': p.region, '到访状态': p.status,
  '到访城市/城镇数': p.cities.length, '到访城市/城镇': p.cities.join('；'), '地点线索数': p.candidates,
  '最早线索日': p.first, '最晚线索日': p.last, '关联正文': p.sources.join('；'),
  '着色': p.visited ? '青绿色' : '浅蓝色',
}));
export const routeRows = atlas => atlas.routes.map(r => ({
  '交通编号': r.id, '日期或区间': r.date, '交通方式': r.mode, '交通工具':r.vehicle||'', '原方式标签':r.sourceMode||r.mode,'移动范围':r.movementExtent,'途经节点': r.names.join('；'),
  '里程公里': r.km ?? '', '里程依据': r.distanceBasis, '发生状态': r.status,
  '发生依据': r.evidence || '', '国家地区': [...new Set(r.countries)].join('；'), '关联正文': r.source,
  '行程编号':r.journeyId||'', '行程名称':r.journeyName||'', '出发基地':r.base||'',
  '飞行时长分钟':r.mode==='飞机'?(r.minutes??''):'','飞行时长依据':r.durationBasis||'',
  '地点编号序列':(r.nodePlaceIds||[]).join('；'),'距离模型':r.distanceModel||'',
  '节点编号序列':(r.nodeIds||[]).join('；'),'记录类型':r.recordType||'旅行航段',
  '计程纳入':r.countDistance===false?'否':'是','被覆盖交通段':(r.metricOwnerIds||[]).join('；'),'方式核定交通编号':r.classificationRef||'',
  '开始日期':r.startDate||r.date,'结束日期':r.endDate||r.date,'时间精度':r.timePrecision||'沿用原日期','段序':r.sequence??'',
}));

export async function refreshAtlas({ vault, output, syncVault = false, source:sourceOverride } = {}) {
  if(!output){
    const config=await readAtlasConfig();
    output=config.output||join(WORKSPACE_ROOT,'outputs');
  }
  const loaded = await loadAtlas(vault, {}, {source:sourceOverride});
  // Resolve all source dependencies before writing derived output, including
  // private receipts referenced by the reviewed tables.
  const sources=[...await sourceManifest(loaded.folder, undefined, ROOT, loaded.source),...await runtimeManifest(ROOT)];
  const dataDir=join(output,'data');
  const checksDir=join(output,'checks');
  await Promise.all([mkdir(output,{recursive:true}),mkdir(dataDir,{recursive:true}),mkdir(checksDir,{recursive:true})]);
  if(loaded.atlas.mobility)await writeGlobalMobility(loaded.atlas.mobility,dataDir);
  else await writeFile(join(dataDir,'全球移动-观测处置.csv'),csv([]));
  let candidates=[];
  try { candidates=parseCsv(await readFile(sourcePath(loaded.source,TABLES.visitCandidates),'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const audit=createContinuityAudit(loaded.atlas,candidates);
  await writeFile(join(checksDir,'全旅程数据点-节点连续性审计.csv'),csv(audit.rows,AUDIT_HEADERS));
  await writeFile(join(checksDir,'全旅程数据点-节点连续性审计.json'),JSON.stringify({generatedAt:new Date().toISOString(),...audit},null,2)+'\n');
  await writeFile(join(dataDir,'全旅程数据点-交通明细.csv'),csv(routeRows(loaded.atlas)));
  await writeFile(join(dataDir,'移动分类统计.json'),JSON.stringify(loaded.atlas.movement,null,2)+'\n');
  await writeFile(join(dataDir,'接续重建-进度.json'),JSON.stringify(reconstructionProgress(loaded.atlas),null,2)+'\n');
  await writeFile(join(dataDir,'接续重建-明细.csv'),csv(connectionReconstructionRows(loaded.atlas)));
  await writeFile(join(dataDir,'国家地区旅行强度.csv'),csv(loaded.atlas.countries.map((c,i)=>({'排名':i+1,'国家地区':c.name,'区域内移动公里':c.km,'境内飞行公里':c.flightKm,'地面与水路公里':c.groundKm,'计程移动记录数':c.records,'排序依据':'区域内移动里程降序；跨境路线不虚拆；包含日常通勤'}))));
  await writeFile(join(dataDir,'全旅程数据点-到访实例阅读.csv'),csv(visitInstanceRows(loaded.atlas.visitInstances)));
  for(const [file,content] of [[ACCESS,csv(accessRows(loaded.atlas.locationLayer.places),ACCESS_HEADERS)],[REFS,csv(loaded.atlas.nodeReferences,REF_HEADERS)]]){
    await writeFile(join(dataDir,file),content);
  }
  const trajectory=csv(loaded.atlas.trajectory,TRAJECTORY_HEADERS);
  await writeFile(join(dataDir,TRAJECTORY),trajectory);
  const hub=csv(hubRows(loaded.atlas.hubLinks),HUB_HEADERS);
  await writeFile(join(dataDir,HUB_LINKS),hub);
  const journeys=csv(loaded.atlas.journeySummaries);
  await writeFile(join(dataDir,'全旅程数据点-重构行程.csv'),journeys);
  await writeFile(join(dataDir,'全旅程数据点-行程闭环.csv'),csv(loaded.atlas.journeyContinuity));
  const queue=csv(loaded.atlas.improvements,['类型','对象编号','关联行程编号','待完善内容','关联正文']);
  await writeFile(join(dataDir,'旅行数据点-待完善.csv'),queue);
  await writeFile(join(dataDir,TABLES.prefectures),csv(prefectureRows(loaded.atlas)));
  const catalogNames=Object.fromEntries(Object.entries(await readJson(join(ROOT,'data/region-catalog.json'))).map(([key,config])=>[key,config.name]));
  for(const [key,view] of Object.entries(loaded.atlas.regions)){
    const name=catalogNames[key];
    if(!name)throw new Error('地区缺少中文名，无法命名汇总表：'+key);
    const filename=`${name}旅行数据点-地域汇总.csv`;
    await writeFile(join(dataDir,filename),csv(regionRows(view)));
  }
  await writeFile(manifestPath(output),JSON.stringify(manifestFrom({
    sources,
    atlas:loaded.atlas,
    outputFiles:[
      'data/全旅程数据点-交通明细.csv','data/全旅程数据点-地点接入.csv',
      'data/国家地区旅行强度.csv','data/移动分类统计.json',
      'data/接续重建-进度.json','data/接续重建-明细.csv','data/全球移动-观测处置.csv',
      'data/全旅程数据点-路线节点引用.csv','data/全旅程数据点-城市轨迹.csv',
      'data/全旅程数据点-枢纽接驳.csv','data/全旅程数据点-重构行程.csv',
      'data/全旅程数据点-行程闭环.csv','data/旅行数据点-待完善.csv',
    ],
  }),null,2)+'\n');
  return loaded.atlas;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { vault: { type:'string' }, output: { type:'string' }, 'sync-vault': {type:'boolean',default:false} } });
  refreshAtlas({ vault:values.vault, output:values.output && resolve(values.output), syncVault:values['sync-vault'] })
    .then(a => console.log(JSON.stringify({ world:a.meta, japan:a.japan, modes:a.byMode },null,2)))
    .catch(e => { console.error(e.message); process.exitCode=1; });
}
