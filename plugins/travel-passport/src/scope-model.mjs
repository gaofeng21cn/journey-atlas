// Platform-free query model shared by the browser and the batch export command.
// Scope identity, hierarchy and statistics never depend on page layout.
import {durationSummary} from './transport-time.mjs';
import {isRecordedMovement,isStructuralRoute,countPassportMovement} from './route-semantics.mjs';
// Shared point-in-polygon test: the batch map renderer and the city map both
// need to decide whether a coordinate belongs to a boundary.
const polygonsOf=f=>f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[];
const inRing=(x,y,ring)=>{let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i],[xj,yj]=ring[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)yes=!yes;}return yes;};
export const pointInRing=(p,ring)=>inRing(p[0],p[1],ring);
export const pointInFeature=(p,f)=>polygonsOf(f).some(poly=>inRing(p[0],p[1],poly[0])&&!poly.slice(1).some(r=>inRing(p[0],p[1],r)));
export function createScopeEngine(data) {
  const scopes=new Map(data.scopes.map(s=>[s.id,s])), cache=new Map();
  const resolve=id=>scopes.get(id)?.detailScopeId||id;
  const navigationLeaf=id=>{const s=scopes.get(resolve(id));return s?.level==='city'&&s.detailKind!=='province';};
  if(scopes.size!==data.scopes.length)throw new Error('分区编号重复');
  for(const scope of scopes.values()){
    if(scope.detailScopeId&&scopes.get(scope.detailScopeId)?.level!=='city')throw new Error('分区默认详情须引用已登记城市：'+scope.id);
    const seen=new Set();let at=scope;
    while(at){if(seen.has(at.id))throw new Error('分区层级循环：'+scope.id);seen.add(at.id);
      if(at.parent&&!scopes.has(at.parent))throw new Error('分区上级不存在：'+at.id);at=scopes.get(at.parent);}
  }
  const contains=(scope,node)=>scope.cityId?node.cityId===scope.cityId&&(!scope.districtId||node.districtId===scope.districtId):scope.id==='world'||(scope.unitId
    ? node.unitId===scope.unitId
    : scope.countries.includes(node.country));
  function query(id='world',filters={}) {
    id=resolve(id);
    const key=id+'|'+(filters.tripId||'')+'|'+(filters.date||'');
    if(cache.has(key))return cache.get(key);
    const scope=scopes.get(id);if(!scope)throw new Error('未知分区：'+id);
    const detail=scope.cityId?data.cities?.[scope.cityId]:null;
    const selected=r=>(!filters.date||((r.startDate||r.date)<=filters.date&&(r.endDate||r.date)>=filters.date))&&r.nodes.some(n=>contains(scope,n));
    const inferred=(detail?.inferredRoutes||[]).filter(r=>(!filters.date||r.date===filters.date)&&r.nodes.some(n=>contains(scope,n))&&(!filters.tripId||detail.trips.some(t=>t.id===filters.tripId&&r.date>=t.first&&r.date<=t.last)));
    const sourceRoutes=detail?.routes||data.routes,sourcePlaces=detail?.places||data.places;
    const curated=sourceRoutes.filter(r=>(!filters.tripId||r.tripId===filters.tripId)&&selected(r));
    // The reconstructed daily chain owns observation-based city totals.
    // Curated routes remain visible and separately queryable; they are not
    // added a second time to reconstruction statistics.
    const routes=[...curated,...inferred];
    const references=new Set(routes.flatMap(r=>r.nodes.map(n=>n.id)));
    const places=sourcePlaces.filter(p=>contains(scope,p)&&p.active&&(!(filters.tripId||filters.date)||references.has(p.id)));
    // Preserve the archive's mileage ownership: a regional route counts only
    // when ALL its nodes are inside. Cross-border geometry remains visible.
    const internal=routes.filter(r=>r.nodes.every(n=>contains(scope,n)));
    const border=routes.filter(r=>!r.nodes.every(n=>contains(scope,n)));
    const visited=new Set(places.map(p=>scope.districtId||scope.unitId||scope.placeCoverage?p.id:scope.cityId?p.districtId:scope.level==='country'&&scope.units.length?p.unitId:p.country));
    const units=scope.districtId||scope.unitId?places.map(p=>({id:p.id,name:p.name,active:true})):
      scope.units.map(u=>({...u,active:visited.has(u.id)||scope.coverage?.includes(u.id)}));
    const children=data.scopes.filter(s=>s.parent===id);
    const nodes=new Map();for(const r of routes)for(const n of r.nodes)if(contains(scope,n))nodes.set(n.id,n);
    const activeUnits=units.filter(u=>u.active&&u.counted!==false).length;
    const counted=units.filter(u=>u.counted!==false).length;
    const isWorld=id==='world';
    const cityMetrics=inferred.length?internal.filter(r=>r.reconstructed):null;
    const km=isWorld?data.meta.totalKm:Math.round((cityMetrics||internal.filter(r=>!r.reconstructed)).filter(r=>r.countDistance!==false).reduce((sum,r)=>sum+(r.km||0),0)*10)/10;
    const flightMinutes=isWorld?data.meta.flightMinutes:internal.filter(r=>r.mode==='飞机'&&r.countDuration!==false).reduce((sum,r)=>sum+(r.minutes||0),0);
    const duration=durationSummary(isWorld?data.routes:cityMetrics||internal.filter(r=>!r.reconstructed));
    const reconstructionRoutes=inferred.filter(r=>r.nodes.every(n=>contains(scope,n)));
    const reconstruction=reconstructionRoutes.length?{moves:reconstructionRoutes.filter(r=>countPassportMovement(r,scope)).length,allMoves:reconstructionRoutes.length,walkingMoves:reconstructionRoutes.filter(r=>r.mode==='步行').length,days:new Set(reconstructionRoutes.map(r=>r.date)).size,
      km:Math.round(reconstructionRoutes.reduce((s,r)=>s+r.km,0)),minutes:Math.round(reconstructionRoutes.reduce((s,r)=>s+r.travelMinutes,0)),hours:Math.round(reconstructionRoutes.reduce((s,r)=>s+r.travelMinutes,0)/60),
      gpsMoves:reconstructionRoutes.filter(r=>r.sourceKind==='gps').length,gapMoves:reconstructionRoutes.filter(r=>r.sourceKind==='gap').length,
      distanceRange:[0,1].map(i=>Math.round(reconstructionRoutes.reduce((s,r)=>s+(r.distanceRange?.[i]||r.km),0))),
      hoursRange:[0,1].map(i=>Math.round(reconstructionRoutes.reduce((s,r)=>s+(r.durationRange?.[i]||r.travelMinutes),0)/60))}:null;
    const tracks=(detail?.tracks||[]).filter(t=>(!filters.date||t.date===filters.date)&&(!filters.tripId||detail.trips.some(tr=>tr.id===filters.tripId&&t.date>=tr.first&&t.date<=tr.last)));
    const photoPoints=(detail?.photoPoints||[]).filter(p=>(!filters.date||p.date===filters.date)&&(!filters.tripId||detail.trips.some(tr=>tr.id===filters.tripId&&p.date>=tr.first&&p.date<=tr.last)));
    const observationDays=[...new Set([...tracks.map(t=>t.date),...photoPoints.map(p=>p.date)])].sort();
    const years=[...routes.map(r=>r.date),...observationDays].map(d=>Number(d?.slice(0,4))).filter(y=>Number.isFinite(y)&&y>1900);
    const view={scope,places,routes,internal,border,units,children,nodes:[...nodes.values()],duration,reconstruction,tracks,photoPoints,observationDays,filters,trips:detail?.trips||[],evidence:detail?.evidence,
      stats:{km,flightHours:Math.round(flightMinutes/60),travelHours:duration.hours,travelMinutes:duration.minutes,places:places.length,nodes:isWorld?data.meta.nodes:nodes.size,
        routes:routes.filter(r=>countPassportMovement(r,scope)).length,allMoves:routes.filter(isRecordedMovement).length,walkingMoves:routes.filter(r=>isRecordedMovement(r)&&r.mode==='步行').length,pendingConnections:routes.filter(r=>r.candidate||isStructuralRoute(r)).length,visited:activeUnits,total:counted,percent:counted?Math.round(activeUnits/counted*100):null,
        firstYear:years.length?Math.min(...years):null,lastYear:years.length?Math.max(...years):null}};
    cache.set(key,view);return view;
  }
  const visibility=new Map(),world=scopes.get('world');
  function isVisible(id){
    if(visibility.has(id))return visibility.get(id);const s=scopes.get(id);if(!s)return false;
    if(s.level==='district'&&navigationLeaf(s.parent)&&!s.detailScopeId){visibility.set(id,false);return false;}
    const shown=id==='world'||query(id).places.length>0||s.level==='country'&&s.countries.some(c=>world?.coverage?.includes(c))||data.scopes.some(c=>c.parent===id&&isVisible(c.id));
    visibility.set(id,Boolean(shown));return Boolean(shown);
  }
  return {query,scopes,contains,cache,isVisible,resolve,navigationLeaf,visibleChildren:id=>navigationLeaf(id)?[]:query(id).children.filter(s=>!s.detailScopeId&&isVisible(s.id))};
}

export function boundsOf(points,padding=.12,minimumPadding=.2) {
  if(!points.length)return [-180,-58,180,84];
  const xs=points.map(p=>p[1]),ys=points.map(p=>p[0]);
  const w=Math.min(...xs),e=Math.max(...xs),s=Math.min(...ys),n=Math.max(...ys);
  const dx=Math.max((e-w)*padding,minimumPadding),dy=Math.max((n-s)*padding,minimumPadding);
  return [w-dx,Math.max(-70,s-dy),e+dx,Math.min(84,n+dy)];
}

export function fitProjection(bounds,width=1000,height=640,padding=75) {
  const [w,s,e,n]=bounds,rad=x=>x*Math.PI/180,merc=x=>Math.log(Math.tan(Math.PI/4+rad(Math.max(-85,Math.min(85,x)))/2));
  const top=merc(n),bottom=merc(s),scale=Math.min((width-padding*2)/Math.max(rad(e-w),1e-9),(height-padding*2)/Math.max(top-bottom,1e-9));
  const dx=(width-rad(e-w)*scale)/2,dy=(height-(top-bottom)*scale)/2;
  return ([lat,lon])=>[dx+rad(lon-w)*scale,dy+(top-merc(lat))*scale];
}

export function curvedPath(a,b,mode) {
  const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(len<.2)return '';
  const bow=Math.min(len*(mode==='飞机'?.22:.13),mode==='飞机'?110:40);
  return `M${a[0].toFixed(2)},${a[1].toFixed(2)}Q${((a[0]+b[0])/2-dy/len*bow).toFixed(2)},${((a[1]+b[1])/2+dx/len*bow).toFixed(2)} ${b[0].toFixed(2)},${b[1].toFixed(2)}`;
}
