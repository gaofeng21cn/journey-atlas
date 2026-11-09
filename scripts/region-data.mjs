import { TABLES } from './schema.mjs';
import {validatePlaceEvidence} from './evidence-contract.mjs';
import {movementSummary,isRecordedMovement} from '../src/route-semantics.mjs';
import {createRequire} from 'node:module';
import iso from 'i18n-iso-countries';

iso.registerLocale(createRequire(import.meta.url)('i18n-iso-countries/langs/zh.json'));

const number=x=>x==null||String(x).trim()===''?null:Number(x);
export const REGION_PLACES=TABLES.regionPlaces;
// Validate every ISO country, including those without a dedicated passport.
// Public regional names override locale synonyms; none imply a personal visit.
export const WORLD_COUNTRIES=Object.freeze({...iso.getNames('zh'),HK:'中国香港',MO:'中国澳门',TW:'中国台湾',KR:'韩国',KP:'朝鲜',VA:'梵蒂冈'});
export function readRegionPlaces(rows,catalog,{legacy=true}={}){
  const ids=new Set(),names=new Set();
  const allowed=new Set(Object.values(catalog).flatMap(c=>c.units.map(u=>u.id)));
  const countries=new Map(Object.entries(WORLD_COUNTRIES));
  for(const unit of catalog.europe.units)countries.set(unit.id,unit.name);
  return rows.map(r=>{
    const id=r['地点编号'],name=r['城市/地点'],country=r['国家地区'],code=r['一级区域代码'];
    if(!name||countries.get(r['国家代码'])!==country)throw new Error('国家代码与中文国家或地点不匹配：'+id);
    if(!id||ids.has(id))throw new Error('地区地点编号重复或缺失：'+id);ids.add(id);
    const key=country+'|'+name;if(names.has(key))throw new Error('同国家同地点重复，须归并：'+key);names.add(key);
    const status=r['到访状态'];if(!['已到访','途经/机场','行政区','行政归属','已排除','待核','计划'].includes(status))throw new Error('地点状态无效：'+id);
    if(!['纳入','排除'].includes(r['分享纳入']))throw new Error('分享纳入值无效：'+id);
    if((status==='已到访'||status==='计划')&&(!r['核定依据']||!r['关联正文']))throw new Error('核定/计划地点缺依据与正文：'+id);
    const review=validatePlaceEvidence(r,{legacy,allowHistoricalMigration:!legacy});
    if(!review.ok)throw new Error(`地点证据合同无效：${id}；${review.errors.join('；')}`);
    if(code&&!allowed.has(code))throw new Error('区域代码未登记：'+code);
    const domestic=Object.values(catalog).find(c=>c.english!=='EUROPE'&&c.countries.includes(country));
    if(code&&domestic&&!domestic.units.some(u=>u.id===code))throw new Error('区域代码与所属国家不匹配：'+id);
    if(['美国','瑞士','意大利','希腊'].includes(country)&&status==='已到访'&&!code)throw new Error('已到访地点缺一级区域代码：'+id);
    const lat=number(r['代表纬度']),lon=number(r['代表经度']);
    if((lat===null)!==(lon===null)||(lat!==null&&(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)))throw new Error('地点坐标无效：'+id);
    return {id,name,country,countryCode:r['国家代码'],unitId:code,status,lat,lon,original:r['原地名']||'',originalNames:String(r['原地名']||'').split('；').filter(Boolean),
      first:r['最早线索日'],last:r['最晚线索日'],evidence:r['核定依据'],source:r['关联正文'],evidenceReview:review.evidence,include:r['分享纳入']==='纳入',level:r['节点级别']||'',parentId:r['上级节点编号']||'',transportAccess:r['交通接入确认']||'',transportAccessFrom:r['交通接入起始日期']||'',transportAccessTo:r['交通接入结束日期']||'',groundNames:(r['地面节点关联']||'').split('；').filter(Boolean)};
  });
}
export function regionView(config,places,routes,{coverage=[]}={}){
  const selected=places.filter(p=>config.countries.includes(p.country)).map(p=>({...p,active:p.include&&(p.status==='已到访'||(p.status==='计划'&&config.includePlans))}));
  const coverageNames=new Set(coverage.filter(c=>Number(c.n)>0).map(c=>c.name));
  const units=config.units.map(u=>{const ps=selected.filter(p=>(config.english==='EUROPE'?(p.countryCode):(p.unitId||p.countryCode))===u.id);return {...u,active:Boolean(ps.some(p=>p.active)||(config.activeFromCoverage&&coverageNames.has(u.name))),places:ps.filter(p=>p.active).map(p=>p.name),candidates:ps.length,sources:[...new Set(ps.filter(p=>p.active).flatMap(p=>p.source.split('；')))]};});
  const internal=routes.filter(r=>r.countries.length&&r.countries.every(c=>config.countries.includes(c)));
  // 跨出边界的路线：一端在本地区、另一端在海外。只用于地图边缘的进出标注，
  // 不计入地区公里，也不参与地域着色。
  const border=routes.filter(r=>r.countries.length&&r.countries.some(c=>config.countries.includes(c))&&!r.countries.every(c=>config.countries.includes(c)));
  const active=selected.filter(p=>p.active),regionalRoutes=routes.filter(r=>r.countries.some(c=>config.countries.includes(c))),years=[...active.flatMap(p=>[p.first,p.last]),...regionalRoutes.map(r=>r.date)].filter(Boolean).flatMap(d=>String(d).match(/(?:19|20)\d{2}/g)||[]).map(Number);
  const counted=internal.filter(r=>r.countDistance!==false),flight=counted.filter(r=>r.mode==='飞机'),ground=counted.filter(r=>r.mode!=='飞机');
  const denominator=config.denominator ?? config.units.filter(u=>u.counted!==false).length;
  return {units,places:selected,routes:internal,border,meta:{transportMoves:movementSummary(internal).displayMoves,borderTransportMoves:movementSummary(border).displayMoves,visited:units.filter(u=>u.active&&u.counted).length,
    special:units.filter(u=>u.active&&!u.counted).map(u=>u.name),denominator,cities:active.length,
    km:counted.reduce((s,r)=>s+(r.km??0),0),flightKm:flight.reduce((s,r)=>s+(r.km??0),0),
    groundKm:ground.reduce((s,r)=>s+(r.km??0),0),groups:new Set(units.filter(u=>u.active).map(u=>u.group)).size,
    modes:new Set(counted.map(r=>r.mode).filter(m=>!['地面交通待定','交通方式待定'].includes(m))).size,
    routes:internal.filter(isRecordedMovement).length,borderRoutes:border.filter(isRecordedMovement).length,missingKm:counted.filter(r=>r.km===null).length,
    firstYear:years.length?Math.min(...years):null,lastYear:years.length?Math.max(...years):null}};
}
export const regionRows=view=>view.units.map(u=>({'地域代码':u.id,'中文名称':u.name,'原名/代码':u.native,'地理分组':u.group,
  '到访/覆盖状态':u.active?'纳入展示':u.candidates?'有线索待核':'暂无已核到访','计入主数量':u.counted?'是':'特区单列',
  '已纳入地点数':u.places.length,'已纳入地点':u.places.join('；'),'候选总数':u.candidates,'关联正文':u.sources.join('；')}));
