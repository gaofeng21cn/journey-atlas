// A maintained unknown connection can express continuity without asserting a
// recovered journey. Candidate connections never become display movements.
const excluded = route => route?.include === false || route?.excluded === true ||
  [route?.status, route?.occurrenceStatus, route?.review?.conclusion, route?.evidenceReview?.conclusion].includes('排除');

export function isStructuralRoute(route) {
  return !!route && (route.structuralLink === true || route.continuityType === '资料间隔' ||
    ['资料间隔', '区域接续','节点对应'].includes(route.recordType) || route.occurrenceStatus === '待还原' ||
    route.status === '待还原' || (route.countDistance === false && route.mode === '接续方式待核'));
}

export function isRecordedMovement(route) {
  return !!route && !excluded(route) && !route.candidate && !isStructuralRoute(route) && !route.metricOwnerIds?.length;
}

// Extent and transport are independent: a long movement can stay inside a city.
export function transportMode(route) {
  return ['市内交通','地面交通待定'].includes(route.mode) ? '地面交通' : route.mode;
}

export function movementExtent(route) {
  const countries=route.nodes?.map(n=>n.country)||route.nodeRefs?.map(n=>n.country)||route.countries||[];
  if(countries.some(c=>!c)||!countries.length)return '范围未定';
  if(new Set(countries).size>1)return '跨境';
  const cities=route.cityKeys?.length?route.cityKeys:route.nodes?.length?route.nodes.map(n=>n.cityKey||n.cityId):route.cities||[];
  if(!cities.length||cities.some(c=>!c))return '范围未定';
  return new Set(cities).size===1?'市内':'城际';
}

export function describeMovement(route) {
  return {...route,sourceMode:route.sourceMode||route.mode,mode:transportMode(route),movementExtent:movementExtent(route)};
}

export const excludesWalkingCount=scope=>['world','macro','country'].includes(scope?.movementCountLevel||scope?.level);
export const countPassportMovement=(route,scope)=>isRecordedMovement(route)&&(!excludesWalkingCount(scope)||transportMode(route)!=='步行');

export function movementSummary(routes,scope={level:'country'}) {
  const recorded=routes.filter(isRecordedMovement),modes=new Map(),extents=new Map();
  for(const r of recorded){
    const mode=transportMode(r),row=modes.get(mode)||{mode,records:0,km:0};row.records++;
    if(r.countDistance!==false)row.km+=r.km||0;modes.set(mode,row);
    const extent=r.movementExtent||movementExtent(r);extents.set(extent,(extents.get(extent)||0)+1);
  }
  return {allMoves:recorded.length,walkingMoves:recorded.filter(r=>transportMode(r)==='步行').length,
    displayMoves:recorded.filter(r=>countPassportMovement(r,scope)).length,
    modes:[...modes.values()].map(r=>({...r,km:Math.round(r.km*1000)/1000})).sort((a,b)=>b.records-a.records),
    extents:[...extents].map(([extent,records])=>({extent,records}))};
}

export function orderedDisplayRoutes(routes = []) {
  return routes.filter(route => route && !excluded(route) && !route.candidate && route.recordType!=='节点对应')
    .sort((a, b) => Number(isStructuralRoute(a)) - Number(isStructuralRoute(b)));
}
