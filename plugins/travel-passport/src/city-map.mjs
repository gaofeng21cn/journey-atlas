import {boundsOf,curvedPath} from './scope-model.mjs';
import {frameProject} from './map-frames.mjs';
import {placeLabels} from './map-labels.mjs';
import {isStructuralRoute,isRecordedMovement,orderedDisplayRoutes} from './route-semantics.mjs';
import {gatewayIdentity} from './city-gateways.mjs';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const overlaps=(a,b)=>a.x<b.x+b.w+8&&a.x+a.w+8>b.x&&a.y<b.y+b.h+8&&a.y+a.h+8>b.y;
const line=(points,project)=>points.map(([lon,lat],i)=>{const [x,y]=project([lat,lon]);return `${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`;}).join('');
const contextCache=new WeakMap();
// Fit the selected boundary, without the degree-based minimum padding used
// for city-to-city maps. Reserve a separate border for gateways and labels.
export function cityMapFrame(scope,geo,view){
  const features=scope.districtId?geo.features.filter(f=>f.id===scope.districtId):geo.features;
  const points=features.flatMap(f=>f.geometry.type==='Polygon'?f.geometry.coordinates.flat():f.geometry.coordinates.flat(2));
  const fullBounds=boundsOf(points.map(([lon,lat])=>[lat,lon]),0,0);
  // A catalogue-provided mapBounds is the reading window for a city. Evidence
  // may contain airport transfers, neighbouring towns, or GPS noise outside
  // that window; letting those points resize the map makes the actual city
  // and its movement spine visually disappear. Only evidence-driven views
  // without an explicit window should expand to their observed footprint.
  let bounds=scope.districtId?fullBounds:scope.mapBounds||fullBounds;
  if(!scope.districtId&&!scope.mapBounds&&view?.evidence?.retainedTracks){
    let [w,s,e,n]=bounds;
    const add=([lon,lat])=>{w=Math.min(w,lon);s=Math.min(s,lat);e=Math.max(e,lon);n=Math.max(n,lat);};
    for(const t of view.tracks)for(const p of t.points)add(p);
    for(const p of view.photoPoints||[])add([p.lon,p.lat]);
    bounds=[Math.max(fullBounds[0],w-.015),Math.max(fullBounds[1],s-.015),Math.min(fullBounds[2],e+.015),Math.min(fullBounds[3],n+.015)];
  }
  const frame={features,fullBounds,bounds,extent:[155,55,690,500]};
  frame.project=frameProject(frame);return frame;
}
export function cityMapMarkup(data,engine,view){
  const {scope}=view,geo=data.geometries['city:'+scope.cityId],contextEntry=data.contexts['city:'+scope.cityId],context=contextEntry?.ref?data.contexts[contextEntry.ref]:contextEntry;
  // The page and exported card share the selected continuous-stroke style.
  const flowStyle=view.flowStyle==='flow'?'flow':'solid';
  // Direction is useful when the reader has narrowed the map to one concrete
  // day or trip. On the all-time map, arrows sit on top of many overlapping
  // journeys and make otherwise valid endpoints look detached from nodes.
  // Keep the default reading surface calm and let the nodes carry the route
  // semantics; the filtered view restores explicit direction.
  const directionalRoutes=Boolean(view.filters?.date||view.filters?.tripId);
  const mapFrame=cityMapFrame(scope,geo,view),{bounds,project,features}=mapFrame;
  const inWindow=([x,y])=>x>=155&&x<=845&&y>=55&&y<=555;
  const inBounds=p=>p.lon>=bounds[0]&&p.lon<=bounds[2]&&p.lat>=bounds[1]&&p.lat<=bounds[3];
  const visible=p=>p.level!=='区域接续'&&engine.contains(scope,p)&&inBounds(p);
  const continuityVisible=p=>visible(p)||(p.level==='区域接续'&&p.lon>=bounds[0]&&p.lon<=bounds[2]&&p.lat>=bounds[1]&&p.lat<=bounds[3]);
  // Drawing membership is the reading window, not administrative membership.
  // A nearby suburb can be drawn at its coordinate without activating city
  // coverage; a same-city point outside the window needs a local continuation.
  // In-window regional continuations are internal anchors, not gateways.
  const mapped=p=>inBounds(p);
  const internalCurve=(a,b,mode)=>{
    const p=project([a.lat,a.lon]),q=project([b.lat,b.lon]),dx=q[0]-p[0],dy=q[1]-p[1],len=Math.hypot(dx,dy);if(len<.2)return '';
    const bow=Math.min(len*(mode==='飞机'?.22:.13),mode==='飞机'?110:40),cx=Math.max(155,Math.min(845,(p[0]+q[0])/2-dy/len*bow)),cy=Math.max(55,Math.min(555,(p[1]+q[1])/2+dx/len*bow));
    return `M${p[0].toFixed(2)},${p[1].toFixed(2)}Q${cx.toFixed(2)},${cy.toFixed(2)} ${q[0].toFixed(2)},${q[1].toFixed(2)}`;
  };
  const movementPath=(r,a,b)=>{
    const path=r.path?.map(([lon,lat])=>project([lat,lon]));
    // Do not crop a prominent journey into disconnected fragments when it
    // leaves and re-enters the window. Its full GPS trace remains underneath.
    if(path?.length&&path.every(inWindow))return line([[a.lon,a.lat],...r.path,[b.lon,b.lat]],project);
    return internalCurve(a,b,r.mode);
  };
  const gatewayCatalog=data.gatewayCatalog||[];
  const gatewayFor=n=>gatewayIdentity(n,{scope,catalog:gatewayCatalog});
  const parts=[],flowParts=[],edgeParts=[],gatewayParts=[],active=new Set(view.places.map(p=>p.districtId));
  let structuralFlowCount=0;
  const land=context?.landMask,landPath=land?(land.type==='Polygon'?[land.coordinates]:land.coordinates).map(p=>p.map(r=>line(r,project)+'Z').join('')).join(''):'';
  if(landPath)parts.push('<rect x="155" y="55" width="690" height="500" fill="#edf2ed"/><g clip-path="url(#city-land-clip)">');
  const boundaryPaths=[];
  for(const f of features){const rings=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
    const d=rings.map(poly=>poly.map(r=>line(r,project)+'Z').join('')).join('');
    boundaryPaths.push(d);
    parts.push(`<path class="city-district${active.has(f.id)?' visited':''}" data-district="${esc(f.id)}" d="${d}" fill-rule="evenodd" clip-path="url(#city-map-window)"><title>${esc(f.properties.name)}</title></path>`);
  }
  if(landPath)parts.push('</g>',`<path d="${landPath}" fill="none" stroke="#b6c9bf" stroke-width=".8" clip-path="url(#city-map-window)"/>`);
  if(!contextCache.has(data))contextCache.set(data,new Map());const cache=contextCache.get(data);
  const contextKey=scope.id+'|'+bounds.join(',');
  if(!cache.has(contextKey)){const layers=new Map();for(const f of context?.features||[]){const cls=f.properties.kind+(f.properties.major?' major':'');if(!layers.has(cls))layers.set(cls,[]);layers.get(cls).push(line(f.geometry.coordinates,project));}
    cache.set(contextKey,[...layers].map(([cls,paths])=>`<path class="city-context ${cls}" d="${paths.join('')}"/>`).join(''));}
  parts.push(`<g clip-path="url(#city-map-window)"><g clip-path="url(#city-boundary-clip)">${cache.get(contextKey)}</g></g>`);
  const gateways=new Map(),seen=new Set(),recorded=view.routes.filter(isRecordedMovement),ordered=orderedDisplayRoutes(view.routes),routeEndpointIds=new Set();
  // Full data still drives statistics. The all-years foreground is a spatial
  // sample of directional movement, not thousands of equally thick strokes.
  // A selected day keeps its complete sequence.
  const spatial=new Set(),representative=[];
  for(const r of ordered.filter(r=>r.reconstructed).sort((a,b)=>b.km-a.km)){
    const cells=r.nodes.map(n=>project([n.lat,n.lon]).map(x=>Math.floor(x/24)).join(',')),key=cells.join('>');
    if(!spatial.has(key)){spatial.add(key);representative.push(r);}
  }
  // Cross-window movement always uses the gateway renderer. Sampling applies
  // only to internal strokes, so a sampled route cannot leave an orphan end.
  const crossesWindow=r=>r.nodes.some(mapped)&&r.nodes.some(n=>!mapped(n));
  const displayRoutes=[...ordered.filter(r=>!r.reconstructed||crossesWindow(r)),...(view.filters?.date?ordered.filter(r=>r.reconstructed&&!crossesWindow(r)):representative.filter(r=>!crossesWindow(r)).slice(0,100))];
  // Frequency means distinct journey occurrences, not every reconstructed
  // segment. A single day can contain several GPS moves through the same
  // gateway; counting each segment made labels look artificially inflated.
  const gatewayFrequency=new Map();
  for(const r of recorded)for(const n of r.nodes)if(!mapped(n)){
    const identity=gatewayFor(n),set=gatewayFrequency.get(identity.key)||new Set();
    set.add(r.tripId||r.journeyId||`${r.date||''}|${r.id}`);gatewayFrequency.set(identity.key,set);
  }
  const pair=(a,b)=>[a,b].map(n=>n.lat.toFixed(5)+','+n.lon.toFixed(5)).join('>');
  const recordedPairs=new Set(recorded.flatMap(r=>r.nodes.slice(1).map((n,i)=>pair(r.nodes[i],n))));
  for(const route of displayRoutes)for(let segment=1;segment<route.nodes.length;segment++){const r=route,a=r.nodes[segment-1],b=r.nodes[segment],structural=isStructuralRoute(r),aIn=structural?continuityVisible(a):mapped(a),bIn=structural?continuityVisible(b):mapped(b),key=a.id+'>'+b.id;
    if(!aIn&&!bIn)continue;
    if(structural&&(!aIn||!bIn||recordedPairs.has(pair(a,b))))continue;
    if(seen.has(key))continue;seen.add(key);
    if(aIn&&bIn){const routeClass=`city-route${structural?' structural flow-structure':r.mode==='步行'?' walking':''}${!structural&&r.geometryType==='observed'?' observed':''}${!structural?' flow':''}`;
      const d=!structural&&(!r.reconstructed||r.geometryType==='observed')?movementPath(r,a,b):internalCurve(a,b,r.mode);
      if(!d)continue; // Subpixel movement remains in statistics, without an empty SVG stroke.
      const p=project([a.lat,a.lon]),q=project([b.lat,b.lon]);
      const directed=!structural&&directionalRoutes&&Math.hypot(q[0]-p[0],q[1]-p[1])>=24;
      if(directed)routeEndpointIds.add(b.id);
      const marker=directed?' marker-end="url(#city-flow-arrow)"':'';
      const routeMarkup=`<path class="${routeClass}" data-from="${esc(a.id)}" data-to="${esc(b.id)}"${r.reconstructed?' data-reconstructed="true"':''}${structural?' data-structural-link="true"':''}${marker} d="${d}"><title>${esc(a.name)} → ${esc(b.name)} · ${esc(structural?'必要接续，路径未恢复':r.mode)}${r.reconstructed?' · '+r.km+' 公里 / '+Math.round(r.travelMinutes)+' 分钟':structural?'':r.geometryType==='observed'?' · 实测片段':' · 路线示意'}</title></path>`;
      if(structural){structuralFlowCount++;parts.push(routeMarkup);}else flowParts.push(routeMarkup);}
    else{const away=aIn?b:a,home=aIn?a:b,[ax,ay]=project([away.lat,away.lon]),dx=(ax-500)/470,dy=(ay-310)/285;
      const side=r.mode==='飞机'?((away.lon-home.lon+540)%360)-180>=0?'E':'W':Math.abs(dy)>Math.abs(dx)?dy>0?'S':'N':dx>0?'E':'W';
      // One canonical external identity gets one terminal. The side is a
      // layout property chosen from its first route, not part of identity;
      // otherwise the same city appears once on each map edge.
      const identity=gatewayFor(away),groupId=identity.key;
      if(!gateways.has(groupId))gateways.set(groupId,{id:groupId,name:identity.name,kind:identity.kind||'city',identity,away,side,links:[],frequency:gatewayFrequency.get(identity.key)?.size||1});
      gateways.get(groupId).links.push({home,inbound:!aIn,mode:r.mode,routeId:r.id,reconstructed:r.reconstructed});}
  }
  const reserved=[];
  if(scope.mapBounds&&!scope.districtId){
    const mini=frameProject({bounds:mapFrame.fullBounds,extent:[862,23,110,60]});
    const d=geo.features.map(f=>(f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates).map(p=>p.map(r=>line(r,mini)+'Z').join('')).join('')).join('');
    const a=mini([bounds[3],bounds[0]]),b=mini([bounds[1],bounds[2]]);
    parts.push(`<g class="city-overview"><text x="862" y="14" font-size="10">全市范围</text><path d="${d}" fill-rule="evenodd"/><rect x="${a[0]}" y="${a[1]}" width="${b[0]-a[0]}" height="${b[1]-a[1]}"/></g>`);
    reserved.push({x:852,y:0,w:132,h:90});
  }
  let displayedGateways=0;
  for(const side of ['W','E','N','S']){const vertical=side==='W'||side==='E',limit=vertical?6:4,available=[...gateways.values()].filter(g=>g.side===side);
    const groups=(scope.detailKind==='province'||view.allGateways?available:available.sort((a,b)=>b.frequency-a.frequency||a.away.name.localeCompare(b.away.name,'zh-CN')).slice(0,limit)).sort((a,b)=>vertical?b.away.lat-a.away.lat:a.away.lon-b.away.lon);
    displayedGateways+=groups.length;
    const top=side==='E'&&scope.mapBounds?108:65,bottom=550,gap=Math.min(vertical?34:150,(vertical?bottom-top:760)/Math.max(groups.length,1));
    groups.forEach((g,i)=>{const x=vertical?(side==='E'?880:120):500+(i-(groups.length-1)/2)*gap,y=vertical?(top+bottom)/2+(i-(groups.length-1)/2)*gap:side==='S'?589:55;
      // One uncut curve joins the actual home endpoint to the laid-out gateway.
      // Deduplicate repeated strokes only; opposite directions remain separate.
      const linkCells=new Set();
      for(const l of g.links){const h=project([l.home.lat,l.home.lon]),cell=[...h.map(v=>Math.round(v/12)),l.inbound,l.mode].join('|');
        if(linkCells.has(cell))continue;linkCells.add(cell);
        const d=curvedPath(l.inbound?[x,y]:h,l.inbound?h:[x,y],'市内交通');
        if(directionalRoutes&&l.inbound)routeEndpointIds.add(l.home.id);
        const gatewayTitle=g.kind==='unknown'?`${g.name}：${g.identity?.description||'原始端点只有定位坐标，尚未核定城市名称'}`:g.kind==='local'&&g.away?.name&&g.away.name!==g.name?`${g.name}（${g.away.name}）`:g.name;
        edgeParts.push(`<path class="city-route edge" style="${g.kind==='unknown'?'opacity:.16':''}" data-gateway="${esc(g.id)}" data-gateway-kind="${esc(g.kind)}" data-home="${esc(l.home.id)}" data-inbound="${l.inbound}"${l.reconstructed?' data-reconstructed="true"':''}${directionalRoutes?' marker-end="url(#city-edge-arrow)"':''} d="${d}"><title>${esc(l.inbound?gatewayTitle:l.home.name)} → ${esc(l.inbound?l.home.name:gatewayTitle)}</title></path>`);}
      const name=g.frequency>1?`${g.name} · ${g.frequency}次`:g.name,tx=vertical?x+(side==='E'?9:-9):x,ty=vertical?y+4:side==='S'?y+18:y-12,anchor=vertical?side==='E'?'start':'end':'middle';
      const chars=Array.from(name),limit=vertical?8:Math.max(4,Math.min(10,Math.floor(gap/12)-1)),lines=[];
      const chunk=Math.ceil(chars.length/Math.ceil(chars.length/limit));
      for(let start=0;start<chars.length;start+=chunk)lines.push(chars.slice(start,start+chunk).join(''));
      const firstY=side==='N'?ty-(lines.length-1)*13:vertical?ty-(lines.length-1)*6.5:ty,width=Math.max(...lines.map(l=>Array.from(l).length))*12;
      // Paint terminals above every route. All-time and filtered views share
      // the same visible node and label; only the direction cue changes.
      const gatewayStyle=g.kind==='unknown'?'opacity:.7':'',labelStyle=g.kind==='unknown'?'fill:#969687;font-size:11px':'';
      const gatewayDescription=g.identity?.description||'外部移动端点';
      gatewayParts.push(`<circle class="city-gateway" style="${gatewayStyle}" data-gateway-node="${esc(g.id)}" data-gateway-kind="${esc(g.kind)}" cx="${x}" cy="${y}" r="4.2"/><circle class="city-gateway-core" data-gateway-core="${esc(g.id)}" cx="${x}" cy="${y}" r="1.4"/><text class="city-label city-edge-label" style="${labelStyle}" data-gateway-label="${esc(g.id)}" data-gateway-kind="${esc(g.kind)}" text-anchor="${anchor}"><title>${esc(g.kind==='unknown'?gatewayDescription:name)}</title>${lines.map((l,j)=>`<tspan x="${tx}" y="${firstY+j*13}">${esc(l)}</tspan>`).join('')}</text>`);
      reserved.push({x:anchor==='start'?tx:anchor==='end'?tx-width:tx-width/2,y:firstY-12,w:width,h:lines.length*13+4});
    });
  }
  // Measured movement is foreground information, above the faint gateways and
  // public road context. A paper halo keeps it legible over dense city streets.
  parts.push('<g clip-path="url(#city-map-window)"><g clip-path="url(#city-boundary-clip)">');
  const gpsFlowParts=[];
  for(const [index,t] of view.tracks.entries()){const d=line(t.points,project),flowTrack=view.tracks.length>20&&t.points.length>8&&index%Math.max(1,Math.ceil(view.tracks.length/220))===0;
    if(view.tracks.length<=100)parts.push(`<path class="gps-halo" d="${d}"/>`);
    const markup=`<path class="gps-track${flowTrack?' gps-flow':''}" data-gps-track="true" d="${d}"><title>${esc(t.date)} · ${t.timed||t.start&&t.end?'足迹定位轨迹':'定位线形（片段时间未恢复）'}</title></path>`;
    (flowTrack?gpsFlowParts:parts).push(markup);}
  const photoCells=new Map();for(const p of view.photoPoints||[]){const [x,y]=project([p.lat,p.lon]),key=Math.floor(x/8)+','+Math.floor(y/8),cell=photoCells.get(key)||{x:0,y:0,count:0};cell.x+=x;cell.y+=y;cell.count++;photoCells.set(key,cell);}
  for(const p of photoCells.values())parts.push(`<circle class="photo-location" data-photo-count="${p.count}" cx="${(p.x/p.count).toFixed(1)}" cy="${(p.y/p.count).toFixed(1)}" r="${Math.min(4,1.5+Math.log2(p.count+1)*.45).toFixed(1)}"><title>${p.count} 张定位照片</title></circle>`);
  // The curated journey spine is painted above the dense observation texture.
  // It is the continuity cue; GPS remains evidence texture underneath it.
  // Paint the directional observation subset after the low-opacity texture so
  // the movement cue remains readable instead of disappearing under later
  // tracks. Curated routes still sit above both layers.
  parts.push(...gpsFlowParts,'</g></g>');
  // Journeys join their real endpoints even across concave coastlines. Only
  // observation texture and public background are clipped to administrative
  // land; clipping a journey here erased the middle of an otherwise valid edge.
  parts.push(...edgeParts,...flowParts);
  parts.push(...gatewayParts);
  const hubs=[...new Map([...gateways.values()].flatMap(g=>g.links.filter(l=>l.mode==='飞机'&&!l.home.visited).map(l=>[l.home.id,{...l.home,active:true}]))).values()];
  const frame={extent:[30,20,940,580],project},labels=placeLabels({...view,routes:recorded,places:view.places.filter(visible)},[frame],()=>frame,reserved);
  const hubLabels=placeLabels({...view,places:hubs.filter(mapped)},[frame],()=>frame,[...reserved,...labels.map(l=>l.box)]);
  const districtBoxes=[];
  for(const f of [...features].sort((a,b)=>Number(active.has(b.id))-Number(active.has(a.id)))){const poly=f.geometry.type==='Polygon'?f.geometry.coordinates[0]:f.geometry.coordinates[0][0],xs=poly.map(p=>p[0]),ys=poly.map(p=>p[1]);
    const [x,y]=project([(Math.min(...ys)+Math.max(...ys))/2,(Math.min(...xs)+Math.max(...xs))/2]),name=f.properties.name,box={x:x-name.length*7,y:y-10,w:name.length*14,h:18};
    if(x<155||x>845||y<55||y>555||[...labels.map(l=>l.box),...hubLabels.map(l=>l.box),...reserved,...districtBoxes].some(b=>overlaps(box,b)))continue;
    districtBoxes.push(box);
    parts.push(`<text class="district-label" x="${x}" y="${y}" text-anchor="middle">${esc(name)}</text>`);
  }
  const shownNodes=new Set([...displayRoutes.flatMap(r=>r.nodes.map(n=>n.id)),...view.places.map(p=>p.id)]);
  const displayNodes=[...new Map([...view.nodes,...displayRoutes.flatMap(r=>r.nodes)].map(n=>[n.id,n])).values()];
  for(const p of displayNodes.filter(p=>shownNodes.has(p.id)&&mapped(p))){const [x,y]=project([p.lat,p.lon]),location=p.level==='定位节点',endpoint=routeEndpointIds.has(p.id);
    if(endpoint)parts.push(`<circle class="city-route-endpoint" data-endpoint-node="${esc(p.id)}" cx="${x}" cy="${y}" r="${p.visited?5.5:4.2}"/>`);
    parts.push(`<circle class="city-stop${p.visited?'':' transit'}${location?' location':''}${endpoint?' endpoint':''}" data-node="${esc(p.id)}" cx="${x}" cy="${y}" r="${p.visited?3.5:endpoint?2.5:location?1.35:2}"><title>${esc(p.name)}</title></circle>`);}
  const continuityStops=new Map();for(const r of displayRoutes.filter(isStructuralRoute))for(const p of r.nodes)if(continuityVisible(p)&&p.level==='区域接续')continuityStops.set(p.id,p);
  for(const p of continuityStops.values()){const [x,y]=project([p.lat,p.lon]);parts.push(`<circle class="city-continuity-stop" cx="${x}" cy="${y}" r="2.5"><title>结构接续锚点 · ${esc(p.name)}</title></circle>`);}
  for(const l of labels)parts.push(`<path class="city-leader" d="M${l.nodeX},${l.nodeY}L${l.x+(l.anchor==='end'?4:-4)},${l.y-5}"/><text class="city-label place-label" data-place-label="${esc(l.id)}" x="${l.x}" y="${l.y}" text-anchor="${l.anchor}">${esc(l.name)}</text>`);
  for(const l of hubLabels)parts.push(`<path class="city-leader" d="M${l.nodeX},${l.nodeY}L${l.x+(l.anchor==='end'?4:-4)},${l.y-5}"/><text class="city-label city-hub-label" data-hub-label="${esc(l.id)}" x="${l.x}" y="${l.y}" text-anchor="${l.anchor}">${esc(l.name)}</text>`);
  parts.push(`<text class="city-source" x="500" y="630" text-anchor="middle">${esc(scope.source)}</text><g class="north-mark" transform="translate(45 555)"><text y="-10" text-anchor="middle">N</text><path d="M0 0L-5 18L0 14L5 18Z"/></g>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 640" data-gateway-count="${gateways.size}" data-gateways-visible="${displayedGateways}" data-track-count="${view.tracks.length}" data-flow-count="${flowParts.length+structuralFlowCount+gpsFlowParts.length}" data-directional="${directionalRoutes}" data-photo-count="${view.photoPoints?.length||0}" style="--gps-width:${view.tracks.length<=20?2.5:view.tracks.length>500?.75:1.6};--gps-opacity:${view.tracks.length<=20?.86:view.tracks.length>500?.08:.6}" role="img" aria-label="${esc(scope.name)}城市旅行地图"><style>
    .city-district{fill:#eff2e9;stroke:#b9c8b8;stroke-width:.8;cursor:pointer}.city-district.visited{fill:#e6ecdf}.city-district:hover{fill:#d8e4d4;stroke:#749181;stroke-width:1.6}.city-context{fill:none;stroke:#d5decd;stroke-width:.7;pointer-events:none}.city-context.major{stroke:#c4d2bf;stroke-width:1.3}.city-context.water{stroke:#c1d8d1;stroke-width:1.4;opacity:.65}.city-context.rail{stroke:#c0ccbf;stroke-width:.6;stroke-dasharray:2 3}.gps-track{fill:none;stroke:#709d8d;stroke-width:1.2;opacity:.48;pointer-events:none}.city-route{fill:none;stroke:#597e69;stroke-width:1.5;stroke-linecap:round;opacity:.74;pointer-events:none}.city-route.walking{stroke:#bd8267;stroke-dasharray:2 3}.city-route.edge{stroke:#a8a090;stroke-dasharray:4 5;stroke-width:1;opacity:.55}.city-stop{fill:#d98268;stroke:#fafbf6;stroke-width:1.5;cursor:pointer}.city-stop.transit{fill:#9da99a}.city-gateway{fill:#fafbf6;stroke:#9e9b86;stroke-width:1.1}.city-label,.district-label{font:14px 'Helvetica Neue','PingFang SC',sans-serif;fill:#52634f;paint-order:stroke;stroke:#fafbf6;stroke-width:3;pointer-events:none}.city-label{font-weight:500;fill:#596856}.city-edge-label{font-size:12px}.district-label{fill:#839078;font-size:15px;letter-spacing:1px;stroke-width:2}.city-leader{fill:none;stroke:#96a88f;stroke-width:.6;pointer-events:none}.city-source{font:9px 'PingFang SC',sans-serif;fill:#98a48e}.north-mark{fill:#526955;font:10px Arial}
    .city-context{opacity:.5}.city-context.major{opacity:.65}.city-route.edge{opacity:.27}.gps-halo{fill:none;stroke:#fafbf6;stroke-width:calc(var(--gps-width) + 2);stroke-linecap:round;opacity:.8;pointer-events:none}.gps-track{stroke:#367f6a;stroke-width:var(--gps-width);opacity:var(--gps-opacity);stroke-linecap:round;stroke-linejoin:round}.gps-flow{stroke:#3d8b73;stroke-width:1.1px;opacity:.42;stroke-dasharray:2 8;animation:gps-flow 3.8s linear infinite}.photo-location{fill:#b69a62;fill-opacity:.38;stroke:#fafbf6;stroke-width:.6}.city-route.flow{stroke:#397d69;stroke-width:2.15;opacity:.9;stroke-dasharray:1 8;animation:journey-flow 2.8s linear infinite}.city-route.flow.observed{stroke:#287b66;stroke-width:2.5;stroke-dasharray:8 7}.city-route.structural{stroke:#a0ab9c;stroke-width:.8;stroke-dasharray:2 5;opacity:.25}.city-route.flow-structure{stroke:#789482;stroke-width:1.15;stroke-dasharray:3 8;opacity:.42;animation:continuity-flow 4.6s linear infinite}.city-continuity-stop{fill:#fafbf6;stroke:#789482;stroke-width:1.2;opacity:.8}.city-route-endpoint{fill:#fafbf6;stroke:#3a7f69;stroke-width:1.1;opacity:.95;pointer-events:none}.city-gateway-core{fill:#9e9b86;pointer-events:none}.city-overview{pointer-events:none;fill:#879586;font:10px 'PingFang SC',sans-serif}.city-overview path{fill:#ecf0e6;stroke:#abbba5;stroke-width:.5}.city-overview rect{fill:#719782;fill-opacity:.1;stroke:#719782;stroke-width:.8}@keyframes journey-flow{to{stroke-dashoffset:-36}}@keyframes continuity-flow{to{stroke-dashoffset:-28}}@keyframes gps-flow{to{stroke-dashoffset:-28}}@media(prefers-reduced-motion:reduce){.city-route.flow,.city-route.flow-structure,.gps-flow{animation:none}}
${flowStyle==='solid'?`
    /* Continuous strokes also override the more specific observed-track rule. */
    .city-route.flow,.city-route.flow.observed,.city-route.flow-structure,.city-route.edge,.gps-flow{stroke-dasharray:none;animation:none}
    .city-route.flow,.city-route.flow.observed{stroke:#3a7f69;stroke-width:1.75;opacity:.78}
    .city-route.flow.walking{stroke:#bd8267;stroke-width:1.5;opacity:.7}
    .city-route.flow-structure{stroke:#93a894;stroke-width:1;opacity:.34}
    .city-route.edge{stroke:#999a85;stroke-width:1.05;opacity:.5}
    .gps-track,.gps-flow{stroke:#3d8b73;stroke-width:1;opacity:${view.tracks.length<=20?.5:view.tracks.length>500?.045:.16}}
    .city-stop.location{fill:#6c9783;stroke-width:.7;opacity:.7}
`:''}
  </style><defs><marker id="city-flow-arrow" viewBox="0 0 10 10" refX="18" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0 10 5 0 10Z" fill="#397d69"/></marker><marker id="city-edge-arrow" viewBox="0 0 10 10" refX="19" refY="5" markerWidth="7.5" markerHeight="7.5" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0 10 5 0 10Z" fill="#999a85"/></marker><clipPath id="city-land-clip"><path d="${landPath}" clip-rule="evenodd"/></clipPath><clipPath id="city-map-window"><rect x="155" y="55" width="690" height="500"/></clipPath><clipPath id="city-clip"><rect width="1000" height="615"/></clipPath><clipPath id="city-boundary-clip">${boundaryPaths.map(d=>`<path d="${d}" clip-rule="evenodd"/>`).join('')}</clipPath></defs><g clip-path="url(#city-clip)">${parts.slice(0,-1).join('')}</g>${parts.at(-1)}</svg>`;
}
