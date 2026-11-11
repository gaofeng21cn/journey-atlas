import {createHash} from 'node:crypto';
import {greatCircleKm} from './travel-layers.mjs';

export const ACCESS='全旅程数据点-地点接入.csv';
export const REFS='全旅程数据点-路线节点引用.csv';
export const ACCESS_HEADERS=['地点编号','国家地区','地点名称','到访状态','分享纳入','节点级别','上级节点编号','交通接入确认','交通接入起始日期','交通接入结束日期','接入状态','进入交通段数','离开交通段数','移动边总数','接入行程数','进入交通编号','离开交通编号','接入交通编号','接入行程编号','交通节点关联数','到访实例数','完整到访实例数','待核到访实例数','首次接入日期','最后接入日期','待接入原因','关联正文'];
export const REF_HEADERS=['交通编号','节点序号','节点编号','节点类型','地点编号','服务城市地点编号','关联地点编号','节点名称','国家地区','纬度','经度','匹配说明','所属行程编号','分享纳入','关联正文'];
export const transportNodeId=(name,point,country='')=>'TN-'+createHash('sha256').update(JSON.stringify([country,name,point])).digest('hex').slice(0,16);

// This finds an explicitly named service association, not physical identity.
// A registered alias may match; a shared prefix or a nearby city may not.
const nodeNameVariants=name=>{
  const raw=String(name||'').trim();
  const compact=raw.replace(/国际机场|机场|国际|空港/g,'').replace(/[·・\s]/g,'');
  return new Set([raw,...(compact.length>=2?[compact]:[])]);
};
const chineseOnlyCountries = new Set(['中国','中国香港','中国澳门']);
export function displayPlaceName(place) {
  if (!place?.name) return '';
  if (chineseOnlyCountries.has(place.country)) return place.name;
  const original = String(place.original || '').split('；').map(s => s.trim()).filter(Boolean)
    .find(s => s && s !== place.name && /^[A-Za-zÀ-ÖØ-öø-ÿΑ-ωА-я0-9 .,'’\-]+$/.test(s));
  return original ? `${place.name}（${original}）` : place.name;
}
export function matchingPlaces(name,point,countries,places,{ground=false}={}){
  const variants=nodeNameVariants(name);
  const nearby=places.filter(p=>countries.includes(p.country)&&p.lat!==null&&p.lon!==null&&greatCircleKm(point,[p.lat,p.lon])<=150);
  const names=p=>[p.name,...(p.altNames||[]),...(p.originalNames||[]),...(ground?p.groundNames||[]:[])];
  const exact=nearby.filter(p=>names(p).some(candidate=>
    [...nodeNameVariants(candidate)].some(n=>variants.has(n))));
  if(exact.length){
    const active=exact.filter(p=>p.include!==false);
    return active.length?active:exact;
  }
  return [];
}

export function bindRouteNodes(records,locations){
  const airportNames=new Set(records.filter(r=>r.mode==='飞机').flatMap(r=>r.names));
  return records.map(r=>{
    const refs=r.points.map((point,i)=>{
      const explicit=r.nodeIds?.[i]||r.nodePlaceIds?.[i];
      const p=explicit?locations.index.get(explicit):null;
      const countries=r.countries.length===r.points.length?[r.countries[i]]:r.countries;
      if(['接驳段','资料间隔','节点对应'].includes(r.recordType)){
        // Controlled links copy already-validated physical endpoint identities.
        // Re-classifying them from names would break their precise anchors.
        return {id:explicit,type:p?'地点':'交通节点',placeId:p?.id||'',servicePlaceId:'',associatedPlaceId:'',
          name:r.names[i],point,displayName:p?displayPlaceName(p):r.names[i],displayPoint:point,
          country:p?.country||countries.join('；'),reason:'前后原始交通端点绑定'};
      }
      const service=matchingPlaces(r.cities?.[i]||r.names[i],point,countries,locations.places,{ground:r.mode!=='飞机'});
      // 机场服务城市只有在地点层明确写出“交通接入确认”时才抬升为正式地点。
      // 这样新加坡可以由客票+照片进入城市链，但普通转机不会被误算成到访。
      const serviceDate=String(r.startDate||r.date||'').slice(0,10);
      const confirmedService=r.mode==='飞机'&&service.length===1&&service[0].include!==false&&service[0].status==='已到访'&&service[0].transportAccess==='确认' &&
        (!service[0].transportAccessFrom||serviceDate>=service[0].transportAccessFrom) &&
        (!service[0].transportAccessTo||serviceDate<=service[0].transportAccessTo) ? service[0] : null;
      // 历史地面边的 TN 编号可以已对应一个明确核定的城市/景区。
      // 唯一地名+同国+坐标校验后绑定正式节点；机场/车站仍保留交通身份。
      // 这里只绑定已核地点，不把沿途线索或航空服务城市升级成到访。
      const bareCity=service.length===1&&r.names[i]===service[0].name;
      const physicalTransport=r.mode==='飞机'||/机场|空港|车站|站$/.test(r.names[i])||
        (airportNames.has(r.names[i])&&!bareCity)||p?.level==='交通节点'||p?.status==='途经/机场';
      const groundPlace=!p&&!physicalTransport&&!['接驳段','资料间隔','节点对应'].includes(r.recordType)&&service.length===1&&
        service[0].status==='已到访'&&service[0].include!==false&&greatCircleKm(point,[service[0].lat,service[0].lon])<=2?service[0]:null;
      // A flight's service city never replaces its airport. Even a confirmed
      // ground visit needs its own arrival/departure movement at that place.
      const explicitPhysical=p&&(p.level==='交通节点'||p.status==='途经/机场')&&
        p.lat!==null&&p.lon!==null&&greatCircleKm(point,[p.lat,p.lon])<=2?p:null;
      const resolved=physicalTransport?explicitPhysical:p||groundPlace;
      const servicePlace=service.length===1?service[0]:null;
      const associated=physicalTransport&&(p?.status==='已到访'?p:confirmedService||servicePlace);
      const displayPoint=physicalTransport?point:resolved&&resolved.lat!==null&&resolved.lon!==null?[resolved.lat,resolved.lon]:point;
      const displayName=physicalTransport?r.names[i]:resolved?displayPlaceName(resolved):r.names[i];
      const id=resolved?.id||(/^TN-/.test(explicit||'')?explicit:transportNodeId(r.names[i],point,countries.join('；')));
      return {id,
        type:resolved&&!physicalTransport?'地点':'交通节点',placeId:resolved?.id||'',servicePlaceId:physicalTransport?servicePlace?.id||associated?.id||'':!resolved?servicePlace?.id||'':'',associatedPlaceId:associated?.id||'',transportAccessConfirmed:!!confirmedService,
        name:r.names[i],point,displayName,displayPoint,country:resolved?.country||countries.join('；'),
        reason:physicalTransport?(explicitPhysical?'显式物理交通节点':associated?'保留机场/车站身份；服务地点仅关联，不代替进入离开边':'独立物理交通节点'):p?'显式地点编号':groundPlace?'地面路线显式别名与坐标绑定已核地点':service.length>1?'多地点服务范围，保留交通节点':service.length===1?'仅服务城市关联，不证明到访':'独立交通节点'};
    });
    return {...r,nodeRefs:refs,nodeIds:refs.map(n=>n.id),nodePlaceIds:refs.map(n=>n.placeId),
      displayPoints:refs.map(n=>n.displayPoint),displayNames:refs.map(n=>n.displayName)};
  });
}

export function attachAccess(locations,routes,{visitInstances=[]}={}){
  const direct=new Map(),services=new Map();
  for(const r of routes)for(const [i,n] of (r.nodeRefs||[]).entries()){
    const target=n.placeId?direct:services,id=n.placeId||n.associatedPlaceId||n.servicePlaceId;
    if(!id)continue;
    if(!target.has(id))target.set(id,new Map());
    const existing=target.get(id).get(r.id)||{route:r,in:[],out:[]};
    if(n.placeId){
      if(i>0&&r.nodeRefs[i-1].id!==n.id)existing.in.push(r);
      if(i<r.nodeRefs.length-1&&r.nodeRefs[i+1].id!==n.id)existing.out.push(r);
    }
    target.get(id).set(r.id,existing);
  }
  const places=locations.places.map(p=>{
    const edgeInfo=[...(direct.get(p.id)?.values()||[])],edges=edgeInfo.map(x=>x.route),service=[...(services.get(p.id)?.values()||[])].map(x=>x.route);
    // Service-city matches are evidence of airport/transport contact only. They
    // must not masquerade as both ends of a city-to-city movement; only an
    // explicit place edge can establish entry or exit continuity.
    const incoming=[...new Map(edgeInfo.flatMap(x=>x.in.map(r=>[r.id,r]))).values()];
    const outgoing=[...new Map(edgeInfo.flatMap(x=>x.out.map(r=>[r.id,r]))).values()];
    const dates=edges.map(r=>r.startDate||r.date).filter(Boolean).sort();
    const eligible=p.status==='已到访'&&p.include;
    const visits=visitInstances.filter(v=>v.placeId===p.id&&v.include!==false);
    const visitAccess=v=>v.access||v;
    const completeVisits=visits.filter(v=>visitAccess(v).complete===true&&!visitAccess(v).pending);
    const pendingVisits=visits.filter(v=>visitAccess(v).pending||visitAccess(v).complete!==true);
    const instanceComplete=visits.length>0&&!pendingVisits.length;
    const visitStates=new Set(visits.map(v=>visitAccess(v).state).filter(Boolean));
    const completeState=visitStates.has('待还原')?'接续完整，细节待还原':visitStates.has('有据重构')?'接续完整，有据重构':'完整接续';
    const state=!p.include?'排除':p.status==='途经/机场'?'仅机场/交通节点':p.status==='待核'?'待核接入':
      instanceComplete?completeState:visits.length?'到访实例待接续':incoming.length&&outgoing.length?'历史关联待逐次核定':incoming.length?'仅入边':outgoing.length?'仅出边':service.length?'仅机场/交通节点':'仅地点证据';
    return {...p,access:{state,routes:edges.map(r=>r.id),journeys:[...new Set(edges.map(r=>r.journeyId).filter(Boolean))],
      incoming:incoming.map(r=>r.id),outgoing:outgoing.map(r=>r.id),transportRoutes:service.map(r=>r.id),visits:visits.map(v=>v.id),completeVisits:completeVisits.map(v=>v.id),pendingVisits:pendingVisits.map(v=>v.id),first:dates[0]||'',last:dates.at(-1)||'',pending:eligible&&!instanceComplete,
      reason:eligible&&!instanceComplete?(pendingVisits.length?pendingVisits.map(v=>visitAccess(v).reason||`到访 ${v.id} 未核定进出移动`).join('；'):incoming.length&&outgoing.length?'历史入出边已关联，但不能跨年代合并证明每次到访完整':incoming.length?'只有进入边，缺少离开移动':outgoing.length?'只有离开边，缺少进入移动':service.length?'只有机场或交通接触，缺少明确进出地点的移动':'地点已核定，但没有移动引用此编号'):''}};
  });
  locations.places=places;locations.index=new Map(places.map(p=>[p.id,p]));
  locations.summary={...locations.summary,connected:places.filter(p=>p.status==='已到访'&&p.include&&p.access.visits.length&&!p.access.pending).length,
    pendingAccess:places.filter(p=>p.access.pending).length,
    accessStates:Object.fromEntries([...new Set(places.map(p=>p.access.state))].map(s=>[s,places.filter(p=>p.access.state===s).length]))};
  return locations;
}

export const accessRows=places=>places.map(p=>({'地点编号':p.id,'国家地区':p.country,'地点名称':p.name,'到访状态':p.status,
  '分享纳入':p.include?'纳入':'排除','节点级别':p.level,'上级节点编号':p.parentId||'','交通接入确认':p.transportAccess||'','交通接入起始日期':p.transportAccessFrom||'','交通接入结束日期':p.transportAccessTo||'','接入状态':p.access.state,
  '进入交通段数':p.access.incoming.length,'离开交通段数':p.access.outgoing.length,'移动边总数':p.access.routes.length,'接入行程数':p.access.journeys.length,
  '进入交通编号':p.access.incoming.join('；'),'离开交通编号':p.access.outgoing.join('；'),'接入交通编号':p.access.routes.join('；'),
  '接入行程编号':p.access.journeys.join('；'),'交通节点关联数':p.access.transportRoutes.length,
  '到访实例数':p.access.visits.length,'完整到访实例数':p.access.completeVisits.length,'待核到访实例数':p.access.pendingVisits.length,
  '首次接入日期':p.access.first,'最后接入日期':p.access.last,'待接入原因':p.access.reason,'关联正文':p.source}));
export const referenceRows=routes=>routes.flatMap(r=>(r.nodeRefs||[]).map((n,i)=>({'交通编号':r.id,'节点序号':i+1,
  '节点编号':n.id,'节点类型':n.type,'地点编号':n.placeId,'服务城市地点编号':n.servicePlaceId,'关联地点编号':n.associatedPlaceId||'','节点名称':n.name,
  '国家地区':n.country,'纬度':n.point[0],'经度':n.point[1],'匹配说明':n.reason,'所属行程编号':r.journeyId||'',
  '分享纳入':r.include?'纳入':'排除','关联正文':r.source})));
