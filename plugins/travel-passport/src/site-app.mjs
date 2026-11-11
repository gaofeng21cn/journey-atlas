import {createScopeEngine} from './scope-model.mjs';
import {mapMarkup,passportSvg,passportLines} from './site-map.mjs';
import {rankPlaces} from './map-labels.mjs';
import {bindMapViewport} from './map-interactions.mjs';
import {isRecordedMovement,countPassportMovement,excludesWalkingCount} from './route-semantics.mjs';
import {cityPassportSummary} from './city-passport-summary.mjs';

const data=JSON.parse(document.getElementById('atlas-data').textContent),engine=createScopeEngine(data);
const $=id=>document.getElementById(id),fmt=n=>n.toLocaleString('en-US');
const icons={globe:'<circle cx="16" cy="16" r="12"/><ellipse cx="16" cy="16" rx="6" ry="12"/><path d="M4 16h24M7 9h18M7 23h18"/>',
  plane:'<path d="m4 19 10-4 8-9c2-2 5-3 6-2s0 4-2 6l-9 8-4 10-3-2 2-9-7 5-3-3 4-4Z"/>',
  clock:'<circle cx="16" cy="16" r="12"/><path d="M16 8v9l6 4"/>',
  pin:'<path d="M16 29S5 19 5 12a11 11 0 0 1 22 0c0 7-11 17-11 17Z"/><circle cx="16" cy="12" r="4"/>',
  map:'<path d="m4 6 8-3 8 3 8-3v24l-8 3-8-3-8 3ZM12 3v24M20 6v24"/>'};
const icon=name=>`<svg viewBox="0 0 32 32" aria-hidden="true">${icons[name]||icons.map}</svg>`;
let current='world',view,tooltipTimer,cityFilters={},allGateways=false;
const expanded=new Set(['world']),manualExpanded=new Set(['world']),treeRows=new Map(),treeGroups=new Map(),treeToggles=new Map();
const childrenOf=id=>engine.visibleChildren(id).sort((a,b)=>{
  const order=['asia','north-america','europe','south-america','africa','oceania','antarctica','china','japan','southeast-asia','usa'];
  const rank=s=>order.includes(s.id)?order.indexOf(s.id):50;
  return rank(a)-rank(b)||(engine.query(b.id).stats.places>0)-(engine.query(a.id).stats.places>0)||a.name.localeCompare(b.name,'zh-CN');
});
// Prefer the actual country over a larger configured scope containing it.
const scopeForCountry=name=>data.scopes.find(s=>s.level==='country'&&s.name===name)||data.scopes.find(s=>s.level==='country'&&s.countries.length===1&&s.countries[0]===name);

function scopeButton(s,small=false){const b=document.createElement('button');b.type='button';b.dataset.scope=s.id;
  if(small){b.textContent=s.name;const detail=document.createElement('small');detail.textContent=' · '+({world:'全球',macro:'大区',country:'国家',unit:'行政区'}[s.level]||'');b.append(detail);}
  else{b.className='nav-button';b.innerHTML=icon(s.level==='world'?'globe':'map');const label=document.createElement('span');label.textContent=s.name;const en=document.createElement('small');en.textContent=s.english;label.append(en);b.append(label);}
  b.addEventListener('click',()=>activate(s.id));return b;}

function syncTree(){
  for(const [id,row]of treeRows){const selected=id===current;row.classList.toggle('active',selected);row.setAttribute('aria-selected',String(selected));
    const b=row.querySelector('.tree-select');if(selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
    if(treeGroups.has(id)){const open=expanded.has(id);row.setAttribute('aria-expanded',String(open));treeGroups.get(id).hidden=!open;
      const t=treeToggles.get(id);t.setAttribute('aria-expanded',String(open));t.setAttribute('aria-label',(open?'收起':'展开')+engine.scopes.get(id).name);}
  }
}
function makeTree(scope,depth=0){
  const item=document.createElement('li');item.setAttribute('role','none');
  const row=document.createElement('div');row.className='tree-row';row.dataset.treeScope=scope.id;row.setAttribute('role','treeitem');row.setAttribute('aria-level',depth+1);row.style.setProperty('--depth',depth);treeRows.set(scope.id,row);
  const children=childrenOf(scope.id);
  if(children.length){const toggle=document.createElement('button');toggle.className='tree-toggle';toggle.type='button';
    toggle.innerHTML='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5"/></svg>';
    toggle.addEventListener('click',()=>{if(expanded.has(scope.id)){expanded.delete(scope.id);manualExpanded.delete(scope.id);}else{expanded.add(scope.id);manualExpanded.add(scope.id);}syncTree();});row.append(toggle);treeToggles.set(scope.id,toggle);
  }else{const spacer=document.createElement('span');spacer.className='tree-spacer';row.append(spacer);}
  const b=document.createElement('button');b.type='button';b.className='tree-select';b.dataset.scope=scope.id;b.textContent=scope.name;b.addEventListener('click',()=>activate(scope.id));row.append(b);item.append(row);
  if(children.length){const group=document.createElement('ul');group.setAttribute('role','group');group.hidden=true;for(const child of children)group.append(makeTree(child,depth+1));treeGroups.set(scope.id,group);item.append(group);}
  return item;
}
const tree=document.createElement('ul');tree.className='scope-tree';tree.setAttribute('role','tree');tree.setAttribute('aria-label','全球旅行分区');tree.append(makeTree(engine.scopes.get('world')));$('primary-nav').append(tree);
function addOptions(id,depth=0){const s=engine.scopes.get(id);if(s.level==='unit'||s.level==='district')return;const o=document.createElement('option');o.value=id;o.textContent='　'.repeat(depth)+s.name;$('scope-select').append(o);for(const c of childrenOf(id))addOptions(c.id,depth+1);}
addOptions('world');
for(const s of data.scopes.filter(s=>s.level==='city'&&engine.isVisible(s.id))){if([...$('scope-select').options].some(o=>o.value===s.id))continue;const o=document.createElement('option');o.value=s.id;o.textContent=s.name+' · 城市';$('scope-select').append(o);}
$('scope-select').addEventListener('change',e=>activate(e.target.value));
$('detail-select').addEventListener('change',e=>{if(e.target.value)activate(e.target.value);});
$('scope-search').addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();$('search-results').replaceChildren();if(!q)return;
  for(const s of data.scopes.filter(s=>!s.detailScopeId&&engine.isVisible(s.id)&&(s.name+' '+s.english).toLowerCase().includes(q)).slice(0,40))$('search-results').append(scopeButton(s,true));});

function stat(value,unit,label,type){return `<div class="stat-row">${icon(type)}<div><div class="stat-value">${value}<small>${unit}</small></div><div class="stat-note">${label}</div></div></div>`;}

function activate(id,history=true,filters){
  id=engine.resolve(id);
  const start=performance.now();let target=engine.scopes.get(id);while(target&&!engine.isVisible(target.id))target=engine.scopes.get(target.parent);
  if(view?.scope.cityId!==target?.cityId)allGateways=false;
  cityFilters=target?.cityId?(filters||(view?.scope.cityId===target.cityId?cityFilters:{})):{};
  current=target?.id||'world';view=engine.query(current,cityFilters);
  const {scope,stats}=view;
  $('mobile-scope').textContent=scope.name+' · 切换地区';document.querySelector('.navigation').classList.remove('is-open');$('mobile-nav-toggle').setAttribute('aria-expanded','false');
  if(history){const params=new URLSearchParams();if(cityFilters.tripId)params.set('trip',cityFilters.tripId);if(cityFilters.date)params.set('day',cityFilters.date);window.history.replaceState(null,'','#'+encodeURIComponent(current)+(params.size?'?'+params:''));}
  document.title=`${scope.name}旅行护照 · Travel Atlas`;
  $('scope-title').textContent=scope.name+'旅行护照';
  $('passport-english').textContent=scope.english.toUpperCase()+' TRAVEL PASSPORT';
  $('scope-select').value=current; // Unit selection lives in the breadcrumb and detail selector.
  if(scope.level==='unit'||scope.level==='district')$('scope-select').value=scope.parent;
  $('breadcrumbs').replaceChildren();const chain=[];let at=scope;while(at){chain.unshift(at);at=engine.scopes.get(at.parent);}
  expanded.clear();for(const id of manualExpanded)expanded.add(id);for(const s of chain)expanded.add(s.id);syncTree();
  const nav=$('primary-nav'),row=treeRows.get(current),box=row.getBoundingClientRect(),rail=nav.getBoundingClientRect();
  if(box.bottom>rail.bottom)nav.scrollTop+=box.bottom-rail.bottom+12;else if(box.top<rail.top)nav.scrollTop-=rail.top-box.top+12;
  for(const [i,s]of chain.entries()){if(i){const sep=document.createElement('span');sep.textContent='/';$('breadcrumbs').append(sep);}const b=document.createElement('button');b.textContent=s.name;b.addEventListener('click',()=>activate(s.id));$('breadcrumbs').append(b);}
  const options=childrenOf(current);$('detail-select').replaceChildren();const initial=document.createElement('option');initial.value='';initial.textContent=options.length?'进入下一级分区':'已是当前最细分区';$('detail-select').append(initial);
  for(const child of options){const o=document.createElement('option');o.value=child.id;o.textContent=child.name;$('detail-select').append(o);}$('detail-select').disabled=!options.length;$('detail-select').hidden=engine.navigationLeaf(current);
  $('map-stage').innerHTML=mapMarkup(data,engine,{...view,allGateways});
  bindMapViewport($('map-stage'));
  $('city-controls').hidden=!scope.cityId;$('city-evidence').hidden=!scope.cityId;
  const gatewayMap=$('map-stage').querySelector('svg'),gatewayCount=Number(gatewayMap?.dataset.gatewayCount||0),gatewayShown=Number(gatewayMap?.dataset.gatewaysVisible||0);
  $('toggle-gateways').hidden=!engine.navigationLeaf(current)||!allGateways&&gatewayCount<=gatewayShown;$('toggle-gateways').setAttribute('aria-pressed',String(allGateways));$('toggle-gateways').textContent=allGateways?'收起进出城市':'全部 '+gatewayCount+' 个进出城市';
  document.querySelector('.legend').innerHTML=scope.cityId?'<i></i>到访地点 <i class="ground"></i>连续行程 <i class="gps-flow"></i>定位流线 <i class="gps"></i>定位纹理 <i class="photo"></i>拍照位置':'<i></i>到访地点 <i class="air"></i>飞行 <i class="ground"></i>地面与水路';
  if(scope.cityId){
    const all=engine.query('city:'+scope.cityId),option=(value,text)=>{const e=document.createElement('option');e.value=value;e.textContent=text;return e;};
    $('trip-select').replaceChildren(option('','全部城市记录'),...all.trips.map(t=>option(t.id,t.name)));$('trip-select').value=cityFilters.tripId||'';
    const activity=cityFilters.tripId?engine.query('city:'+scope.cityId,{tripId:cityFilters.tripId}):all;
    const dates=[...new Set([...activity.routes.map(r=>r.date),...activity.observationDays])].sort();
    $('day-select').replaceChildren(option('','全部日期'),...dates.map(d=>option(d,d)));$('day-select').value=cityFilters.date||'';
    const complete=all.evidence?.retainedTracks!==undefined&&!cityFilters.tripId&&!cityFilters.date;
    $('city-evidence').textContent=scope.detailKind==='province'?'已有城际移动':
      (complete?fmt(all.evidence.usableGps||0)+' 条定位 · ':'' )+fmt(view.tracks.length)+' 段定位轨迹 · '+fmt(view.photoPoints.length)+' 张定位照片 · '+fmt(view.observationDays.length)+' 个记录日';
    $('city-evidence').title='城市移动包含生活、工作与出游；到访地点与行政覆盖按已核活动统计。';
    $('toggle-photos').hidden=!all.photoPoints.length;
  }
  $('map-period').textContent=stats.firstYear?stats.firstYear+' — '+stats.lastYear:'暂无旅行记录';
  const coverageStat=stat(stats.visited+'<span class="stat-denominator"> / '+stats.total+'</span>','',scope.unitLabel,'globe');
  const fullCityEvidence=scope.cityId&&view.evidence?.retainedTracks!==undefined;
  const observationView=fullCityEvidence&&!cityFilters.tripId;
  const distanceStat=stat(fmt(stats.km),'公里',current==='world'?'累计旅行里程':fullCityEvidence?'已整理活动里程':'区域内旅行里程','plane');
  $('stats').innerHTML=(current==='world'||scope.placeCoverage||scope.unitId||scope.cityId?distanceStat:coverageStat)+
    (current==='world'?coverageStat:scope.placeCoverage||scope.unitId||scope.cityId?'':distanceStat)+
    stat(stats.places,'地点','到访城市与旅行地点','pin')+stat(fmt(stats.travelHours>=10?Math.round(stats.travelHours):stats.travelHours),'小时',fullCityEvidence?'已整理活动交通时间':'交通移动时间','clock');
  if(observationView)$('stats').innerHTML=stat(fmt(view.observationDays.length),'天','定位与照片记录','clock')+
    stat(fmt(view.photoPoints.length),'张','带定位照片','pin')+stat(fmt(view.tracks.length),'段','连续定位片段','map');
  const citySummary=cityPassportSummary(view);
  if(citySummary&&!observationView)$('stats').innerHTML=stat(fmt(citySummary.places),'地点','已核到访地点','pin')+
    (citySummary.activities?stat(citySummary.activities,'次','已整理活动','map'):'')+
    (citySummary.recordedDays?stat(fmt(citySummary.recordedDays),'天','定位与照片记录','clock'):'');
  if(view.reconstruction)$('stats').innerHTML=stat(fmt(view.reconstruction.km),'公里','移动里程','map')+
    stat(fmt(view.reconstruction.hours||view.reconstruction.minutes),view.reconstruction.hours?'小时':'分钟','交通时间','clock')+stat(fmt(view.reconstruction.moves),'段',excludesWalkingCount(scope)?'交通移动':'城市移动','pin');
  $('duration-modes').textContent=view.duration.modes.map(m=>({飞机:'飞行',铁路:'铁路',公路:'公路',轮渡:'水路',缆车:'缆车',山地交通:'山地',地面交通待定:'地面'}[m.mode]||m.mode)+' '+fmt(m.hours)+' h').join(' · ');
  if(observationView)$('duration-modes').textContent=cityFilters.date?'按当地日期显示实际记录':view.trips.length+' 次已整理活动 · '+stats.places+' 个已核地点';
  if(citySummary&&!observationView)$('duration-modes').textContent='按已整理活动与当前筛选显示';
  if(view.reconstruction){
    $('duration-modes').textContent=view.reconstruction.days+' 个移动记录日 · '+view.photoPoints.length+' 张定位照片';
    $('duration-modes').title='交通时间不含识别到的停留、游览与住宿。';
  }
  else $('duration-modes').title='按本区域内交通统计；优先采用已有时长，缺失按里程和交通方式估算，不含住宿、游览及等候。';
  $('coverage-label').textContent=scope.districtId||scope.unitId?'到访地点':scope.detailKind==='province'?'地级市覆盖':scope.cityId?observationView?'已整理活动行政区覆盖':'城市行政区覆盖':scope.placeCoverage?'已核定地点':'次一级区域覆盖';
  $('coverage-ring').style.setProperty('--coverage',(stats.percent||0)+'%');
  $('coverage-ring').hidden=Boolean(scope.districtId||scope.unitId||scope.placeCoverage);
  $('coverage-text').innerHTML=`<b>${scope.districtId||scope.unitId||scope.placeCoverage?stats.places:stats.percent+'%'}</b><span>${scope.districtId||scope.unitId||scope.placeCoverage?'旅行地点':stats.visited+' / '+stats.total+' '+scope.unitLabel}</span>`;
  $('machine').textContent=passportLines(view).join('\n');
  const facts=new Map();for(const r of view.routes.filter(r=>countPassportMovement(r,scope)))for(let i=1;i<r.nodes.length;i++){const a=r.nodes[i-1],b=r.nodes[i];if(a.name===b.name)continue;const key=a.name+' → '+b.name;
    const old=facts.get(key)||{from:a.name,to:b.name,mode:r.vehicle||r.mode,n:0,internal:engine.contains(scope,a)&&engine.contains(scope,b)};old.n++;facts.set(key,old);}
  $('route-list').replaceChildren();for(const f of [...facts.values()].sort((a,b)=>Number(b.internal)-Number(a.internal)||b.n-a.n).slice(0,3)){const e=document.createElement('div');e.className='route-fact';e.textContent=f.from+' → '+f.to;const d=document.createElement('span');d.textContent=f.mode+' · '+f.n+' 段记录';e.append(document.createElement('br'),d,document.createElement('i'));$('route-list').append(e);}
  if(!facts.size)$('route-list').textContent=observationView&&view.tracks.length?fmt(view.tracks.length)+' 段定位移动 · 活动详情尚未整理':'当前分区暂无旅行路线';
  const allYears=[...new Set([...view.routes.map(r=>r.date),...view.observationDays].map(d=>scope.cityId&&cityFilters.tripId?d:Number(d?.slice(0,4))).filter(y=>typeof y==='string'||Number.isFinite(y)))].sort();
  const years=allYears.filter((_,i)=>i===0||i===allYears.length-1||i%Math.ceil(allYears.length/5)===0);
  $('timeline').replaceChildren();for(const y of years){const e=document.createElement(scope.cityId&&cityFilters.tripId?'button':'div');e.className='timeline-stop';e.append(document.createElement('i'),String(y));if(e.tagName==='BUTTON')e.onclick=()=>activate(current,true,{...cityFilters,date:y});$('timeline').append(e);}
  $('place-list').replaceChildren();$('place-more').hidden=true;
  if(current==='world'){
    const intensity=new Map((data.countries||[]).map((c,i)=>[c.name,{...c,rank:i}]));
    const countries=view.units.filter(u=>u.active).sort((a,b)=>(intensity.get(a.name)?.rank??Infinity)-(intensity.get(b.name)?.rank??Infinity));
    $('places-heading').textContent='到访国家与地区';$('places-count').textContent=countries.length+' 个国家与地区 · 按区域内移动里程';
    for(const country of countries){const s=scopeForCountry(country.name);if(s){const button=scopeButton(s,true),metric=intensity.get(country.name);
      if(metric)button.title='区域内移动 '+fmt(Math.round(metric.km))+' 公里';$('place-list').append(button);}}
  }else{
    const places=rankPlaces({...view,routes:view.routes.filter(isRecordedMovement)});$('places-heading').textContent='到访地点';$('places-count').textContent=stats.places+' 个地点';
    const appendPlaces=ps=>{for(const p of ps){const b=document.createElement('button');b.textContent=p.name;b.addEventListener('click',()=>showNode(p.name,p));$('place-list').append(b);}};
    appendPlaces(places.slice(0,18));if(places.length>18){$('place-more').hidden=false;$('place-more').textContent='查看其余 '+(places.length-18)+' 个地点';$('place-more').onclick=()=>{appendPlaces(places.slice(18));$('place-more').hidden=true;};}
  }
  $('map-stage').querySelectorAll('[data-unit]').forEach(p=>p.addEventListener('click',()=>{const id='unit:'+p.dataset.unit;if(engine.scopes.has(id)){if(engine.isVisible(id))activate(id);}else{const u=scope.units.find(u=>u.id===p.dataset.unit||u.mapId===p.dataset.unit),s=scopeForCountry(u?.name||p.dataset.unit);if(s&&engine.isVisible(s.id))activate(s.id);}}));
  $('map-stage').querySelectorAll('[data-district]').forEach(p=>p.addEventListener('click',()=>{const id='district:'+p.dataset.district;
    if(engine.navigationLeaf(current)){const u=view.units.find(u=>u.id===p.dataset.district),count=view.places.filter(n=>n.districtId===p.dataset.district).length;$('node-tooltip').textContent=(u?.name||'行政区')+' · '+count+' 个到访地点';$('node-tooltip').hidden=false;clearTimeout(tooltipTimer);tooltipTimer=setTimeout(()=>{$('node-tooltip').hidden=true;},5000);}
    else if(engine.isVisible(id))activate(id);}));
  $('map-stage').querySelectorAll('[data-node]').forEach(n=>n.addEventListener('click',()=>{const p=view.nodes.find(p=>p.id===n.dataset.node);if(!p)return;
    const city=data.scopes.find(s=>s.level==='city'&&data.cities[s.cityId].parentPlaceIds.includes(p.id));
    const next=scope.cityId?null:scope.level==='unit'?city:scope.level==='country'?engine.scopes.get('unit:'+p.unitId):scopeForCountry(p.country);
    if(next&&next.id!==current&&engine.isVisible(next.id))activate(next.id);else showNode(p.name,p);
  }));
  $('node-tooltip').hidden=true;
  window.__ATLAS_DIAGNOSTICS__={scope:current,queryAndDomMs:performance.now()-start,stats:stats,networkRequestsOnSwitch:0};document.body.dataset.scope=current;
}

function showNode(name,p){const rs=view.routes.filter(r=>isRecordedMovement(r)&&r.nodes.some(n=>n.id===p.id||n.name===name));
  $('node-tooltip').textContent=name+' · '+rs.length+' 条相关路线';$('node-tooltip').hidden=false;clearTimeout(tooltipTimer);tooltipTimer=setTimeout(()=>{$('node-tooltip').hidden=true;},5000);}

function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}

async function exportPassport(type){const id=current,v=engine.query(id,cityFilters),svg=passportSvg(data,engine,{...v,allGateways}),name='旅行护照-'+v.scope.name+'-分享';
  if(type==='svg'){download(new Blob([svg],{type:'image/svg+xml'}),name+'.svg');return;}
  const button=$('export-png');button.disabled=true;button.textContent='正在导出…';
  try{await document.fonts.ready;const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'})),img=new Image();
    try{await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('无法渲染护照'));img.src=url;});
      const canvas=document.createElement('canvas');canvas.width=2240;canvas.height=2988;canvas.getContext('2d').drawImage(img,0,0,2240,2988);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('无法生成 PNG');download(blob,name+'.png');}
    finally{URL.revokeObjectURL(url);}
  }catch(e){$('node-tooltip').textContent=e.message;$('node-tooltip').hidden=false;}
  finally{button.disabled=false;button.textContent='导出旅行护照 PNG';}
}
$('export-png').addEventListener('click',()=>exportPassport('png'));$('export-svg').addEventListener('click',()=>exportPassport('svg'));
const readHash=()=>{const [id,search]=location.hash.slice(1).split('?'),p=new URLSearchParams(search);activate(decodeURIComponent(id)||'world',false,{tripId:p.get('trip')||'',date:p.get('day')||''});};
$('trip-select').onchange=e=>activate(current,true,{tripId:e.target.value});$('day-select').onchange=e=>activate(current,true,{...cityFilters,date:e.target.value});
$('mobile-nav-toggle').onclick=()=>{const open=document.querySelector('.navigation').classList.toggle('is-open');$('mobile-nav-toggle').setAttribute('aria-expanded',String(open));if(open)treeRows.get(current)?.scrollIntoView({block:'nearest'});};
$('toggle-gps').onclick=()=>{const shown=$('toggle-gps').getAttribute('aria-pressed')!=='true';$('toggle-gps').setAttribute('aria-pressed',String(shown));$('map-stage').classList.toggle('hide-gps',!shown);};
$('toggle-photos').onclick=()=>{const shown=$('toggle-photos').getAttribute('aria-pressed')!=='true';$('toggle-photos').setAttribute('aria-pressed',String(shown));$('map-stage').classList.toggle('hide-photos',!shown);};
$('toggle-gateways').onclick=()=>{allGateways=!allGateways;activate(current,true,cityFilters);};
window.addEventListener('hashchange',readHash);
// Batch export and QA use the same public projection as the interactive screen.
window.travelAtlas={activate,query:(id,filters)=>engine.query(id,filters),passport:(id,filters)=>passportSvg(data,engine,engine.query(id,filters)),scopes:data.scopes.map(s=>({id:s.id,name:s.name,level:s.level}))};
readHash();
