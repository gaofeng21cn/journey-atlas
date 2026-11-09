import {readAtlasConfig} from './source-data.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { ROOT, readJson } from './data.mjs';
import { refreshAtlas } from './atlas-data.mjs';
import { japanMap } from './japan-map.mjs';
import { renderRegionMap } from './region-map.mjs';
import { annotateManifest, manifestPath } from './manifest.mjs';
import {buildSite,exportScopes} from './site.mjs';
import { layoutMapLabels } from './map-label-layout.mjs';
import {passportAsset,prepareAsset,writeOutputGuide} from './output-paths.mjs';
import {flightView} from './flight-view.mjs';
import {render as renderFlight} from './render.mjs';
import {renderAnnual,annualConfig} from './render-annual.mjs';
import {isRecordedMovement,isStructuralRoute,orderedDisplayRoutes} from '../src/route-semantics.mjs';

const passportStem = (area, config, social) => {
  const label = area === 'world' ? '全球旅行护照' : area === 'japan' ? '日本旅行护照' : `${config.name}旅行护照`;
  return `${label}-${social ? '分享' : '个人'}`;
};

const esc = s => String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const safeJson = x => JSON.stringify(x).replace(/</g,'\\u003c');
const fmt = n => n.toLocaleString('en-US');

// Passport machine-readable zone: two fixed-width 44-character lines, exactly as
// an ICAO TD3 passport MRZ. Every field is a real value from the maintained CSV
// layers; only the tail is padded with '<' so both lines share one width. Font
// uses natural monospace advance; the footer is not stretched to page width.
const MRZ_WIDTH=44;
const MRZ_UNIT={china:'PROV',usa:'ST',switzerland:'CANT',italy:'REG',europe:'EU'};
const mrzBlock=lines=>lines.map(line=>{
  if(line.length>MRZ_WIDTH)throw new Error(`机读区行超过${MRZ_WIDTH}字符：${line}`);
  return `<span>${esc(line+'<'.repeat(MRZ_WIDTH-line.length))}</span>`;
}).join('');
// Line 1 keeps the real issuing state (CHN) and holder name, then the document title.
const mrzIdentity=(latin,english)=>{
  const machine={"SOUTHEAST ASIA":"SEA","SWITZERLAND":"CH","GREECE":"GR"}[english]||english;
  return `P<CHN${latin?latin.toUpperCase()+'<<':''}MY<${machine}<TRAVEL<PASSPORT`;
};

export async function renderAtlas({vault,source,output,variant='all',scope='all',syncVault=false}={}) {
  if(!['all','personal','social'].includes(variant))throw new Error('--variant 应为 all、personal 或 social');
  const runtimeConfig=await readAtlasConfig();
  if(!output)output=runtimeConfig.output||join(ROOT,'outputs');
  const catalog=await readJson(join(ROOT,'data/region-catalog.json'));
  const areas=['world','japan',...Object.keys(catalog)];
  if(!['all',...areas].includes(scope))throw new Error('--scope 应为 all 或 '+areas.join('、'));
  const selected=scope==='all'?areas:[scope];
  const atlas=await refreshAtlas({vault:source?.type==='obsidian'?vault:undefined,source,output,syncVault});
  const htmlDir=join(output,'html'), checksDir=join(output,'checks');
  await Promise.all([mkdir(output,{recursive:true}),mkdir(htmlDir,{recursive:true}),mkdir(checksDir,{recursive:true})]);
  const [css,extra,worldTemplate,japanTemplate,dots,worldScript,topology]=await Promise.all([
    ...['poster.css','atlas.css','poster.html','japan.html','world-dots.js','atlas-world.js'].map(name=>readFile(join(ROOT,'src',name),'utf8')),
    selected.includes('japan')?readJson(join(ROOT,'data/japan.topojson')):null,
  ]);
  const represented=new Set(JSON.parse(dots.split('=',2)[1].trim().replace(/;$/,'')).map(p=>p[2]));
  const missing=atlas.countries.filter(c=>!represented.has(c.name));
  if(selected.includes('world')&&missing.length)throw new Error(`地图缺国家点：${missing.map(c=>c.name).join('、')}`);
  const profile=existsSync(join(ROOT,'data/profile.json'))?await readJson(join(ROOT,'data/profile.json')):{};
  const regionalTemplate=await readFile(join(ROOT,'src/region.html'),'utf8');
  const regionMaps=Object.fromEntries(await Promise.all(Object.entries(catalog).filter(([key])=>selected.includes(key)).map(async([key,config])=>
    [key,renderRegionMap(config,await readJson(join(ROOT,'data',config.file)),atlas.regions[key],{aliases:atlas.journeyLayer.aliases})])));
  const svg=selected.includes('japan')?japanMap(topology,atlas,{aliases:atlas.journeyLayer.aliases}):'';
  const regionGroups=[...new Set(atlas.prefectures.map(p=>p.region))].map(region=>{
    const names=atlas.prefectures.filter(p=>p.region===region&&p.visited).map(p=>p.name.replace(/[都府县]$/,''));
    return `<div class="pref-group"><h2>${region}</h2><p>${names.length?names.join(' · '):'—'}</p></div>`;
  }).join('');
  const browser=await chromium.launch({headless:true,...(existsSync('/Applications/Google Chrome.app')?{channel:'chrome'}:{})});
  const checks=[];
  try{
    const context=await browser.newContext({viewport:{width:1120,height:1494},deviceScaleFactor:2});
    for(const area of selected)for(const version of variant==='all'?['personal','social']:[variant]){
      const social=version==='social',name=social?'':profile.name||'',latin=social?'':profile.latinName||'';
      const config=catalog[area],view=atlas.regions[area],regional=!!config;
      const values={PAGE_TITLE:name?`${esc(name)}的${area==='japan'?'日本':''}旅行护照`:'我的旅行护照',
        TOPLINE:latin?`${esc(latin)} · ${area==='japan'?'JAPAN JOURNEYS':'WORLD JOURNEYS'}`:area==='japan'?'JAPAN JOURNEYS':'WORLD JOURNEYS',
        OWNER:name?`<span>${esc(name)}<small>${esc(latin)}</small></span>`:'',
        MACHINE_NAME:latin?`${esc(latin.toUpperCase().replace(/[^A-Z0-9]/g,''))}&lt;&lt;`:'',
        YEARS:`${atlas.japan.firstYear} — ${atlas.japan.lastYear}`,JAPAN_MAP:svg,PREFECTURES:regionGroups,
        VISITED:atlas.japan.visited,PERCENT:Math.round(atlas.japan.visited/47*100),
        JAPAN_KM:fmt(atlas.japan.km),JAPAN_CITIES:atlas.japan.cities,REGIONS:atlas.japan.regions,
        MACHINE_LINES:mrzBlock([
          mrzIdentity(latin,'JAPAN'),
          `${atlas.japan.firstYear}<<${atlas.japan.lastYear}<<${atlas.japan.km}KM<<${atlas.japan.visited}/47PREF<<${atlas.japan.cities}PLACES`,
        ])
      };
      if(regional){
        const m=view.meta,coverageTotal=m.denominator,pct=coverageTotal?Math.round(m.visited/coverageTotal*100):0;
        const groups=[...new Set(config.units.map(u=>u.group))].map(group=>{
          const us=view.units.filter(u=>u.active&&u.group===group);if(!us.length)return '';
          const names=us.map(u=>esc(u.name)).join(' · ');
          return `<div class="pref-group"><h2>${esc(group)}</h2>${names===esc(group)?'':`<p>${names}</p>`}</div>`;
        }).join('');
        Object.assign(values,{AREA:area,PAGE_TITLE:`${name?esc(name)+'的':'我的'}${config.name}旅行护照`,
          TOPLINE:(latin?esc(latin)+' · ':'')+config.english+' JOURNEYS',
          YEARS:m.firstYear===m.lastYear?String(m.firstYear):`${m.firstYear} — ${m.lastYear}`,
          REGION_NAME:config.name,REGION_ENGLISH:config.english,REGION_MAP:regionMaps[area].svg,REGION_GROUPS:groups,
          UNIT_LABEL:config.unitLabel,UNIT_ENGLISH:config.unitEnglish,VISITED:m.visited,
          DENOMINATOR:`<span>/ ${coverageTotal}</span>`,
          COVERAGE:`<div class="earth-stat"><b>${pct}<small>%</small></b><span>足迹覆盖</span><div class="coverage-line"><i style="width:${pct}%"></i></div>${m.special.length?`<small class="special-unit">另有${esc(m.special.join('、'))}</small>`:''}</div>`,
          REGION_KM:fmt(m.km),REGION_CITIES:m.cities,REGION_ROUTES:config.includeBorderRoutes?m.borderTransportMoves:m.transportMoves,
          REGION_KM_LABEL:config.kmLabel||'公里旅程',REGION_KM_ENGLISH:config.kmEnglish||'Distance travelled',
          REGION_CITIES_LABEL:config.citiesLabel||'城市 / 地点',REGION_CITIES_ENGLISH:config.citiesEnglish||'Places explored',
          REGION_ROUTES_LABEL:config.routesLabel||'段交通移动',REGION_ROUTES_ENGLISH:config.routesEnglish||'Transport legs',
          MODES:[...new Set(view.routes.filter(r=>isRecordedMovement(r)&&r.countDistance!==false).map(r=>r.mode).filter(m=>!['地面交通待定','交通方式待定'].includes(m)))].map(esc).join(' &nbsp; · &nbsp; '),
          MACHINE_LINES:mrzBlock([
            mrzIdentity(latin,config.english),
            `${m.firstYear}<<${m.lastYear}<<${Math.round(m.km)}KM<<${m.visited}/${coverageTotal}${MRZ_UNIT[area]||'U'}<<${m.cities}P`,
          ])});
      }
      let html=(regional?regionalTemplate:area==='japan'?japanTemplate:worldTemplate).replace(/\{\{([A-Z_]+)\}\}/g,(_,k)=>{if(values[k]===undefined)throw new Error('模板变量缺失：'+k);return values[k];});
      html=html.replace('</head>',`<style>${css}\n${extra}</style></head>`);
      if(area==='world'){
        html=html.replace('<link rel="stylesheet" href="./poster.css" />','').replace('class="poster"','class="poster all-journeys"')
          .replace('世界航线与到访国家地图','世界全旅程路线与国家地图')
          .replace('累计飞行里程 <i>Distance flown</i>','累计旅行里程 <i>Distance travelled</i>')
          .replace('段航程 <i>Flights</i>','段交通移动 <i>Transport legs</i>')
          .replace('国家与地区 <i>Countries</i>','国家与地区 <i>Coverage</i>')
          .replace('城市 / 地点 <i>Places</i>','旅程节点 <i>Stops</i>')
          .replace(/<div class="network-stats">.*?<\/div>/,`<div class="network-stats"><span>飞行 <b>${fmt(atlas.meta.flightKm+atlas.meta.hubFlownKm)}</b> 公里</span><span>地面与水路 <b>${fmt(atlas.meta.groundKm+atlas.meta.hubGroundKm)}</b> 公里</span></div>`);
        html=html.replace(/<footer class="machine">.*?<\/footer>/s,`<footer class="machine">${mrzBlock([
          mrzIdentity(latin,'WORLD'),
          `${atlas.meta.firstYear}<<${atlas.meta.lastYear}<<${atlas.meta.totalKm}KM<<${Math.round(atlas.meta.flightMinutes/60)}H<<${atlas.meta.countries}COUNTRIES`,
        ])}</footer>`);
        // Export only geometry/statistics, without raw dates, sources or ticket rows.
        const view={meta:atlas.meta,countries:atlas.countries,nodes:atlas.nodes,
          routes:orderedDisplayRoutes(atlas.routes).filter(r=>r.recordType!=='资料间隔').map(r=>({mode:r.mode,points:r.points,displayPoints:r.displayPoints,km:r.km,
            structuralLink:isStructuralRoute(r)}))};
        html=html.replace(/    <script src="\.\/world-dots.js"><\/script><script src="\.\/data.js"><\/script><script src="\.\/poster.js"><\/script>/,
          `<script>${dots}</script><script>window.ATLAS_DATA=${safeJson(view)};</script><script>${worldScript}</script>`);
      }
      if(/\{\{[A-Z_]+\}\}|src="\.\//.test(html))throw new Error('模板替换不完整');
      const forbidden=[profile.name,profile.latinName].filter(Boolean);
      if(social&&forbidden.some(n=>html.toLowerCase().includes(n.toLowerCase())))throw new Error('无姓名版仍有姓名');
      const page=await context.newPage(),errors=[];
      page.on('pageerror',err=>errors.push(err.message));
      await page.setContent(html,{waitUntil:'load'});await page.evaluate(()=>document.fonts.ready);
      const mapLabels=await page.evaluate(layoutMapLabels);
      if(mapLabels.collisions.length||mapLabels.clipped.length)throw new Error(JSON.stringify({area,version,mapLabels}));
      // Keep PNG and static HTML identical: serialize the resolved positions,
      // rather than exporting the original overlapping SVG alongside the PNG.
      if(area!=='world')html=await page.content();
      const check=await page.evaluate(()=>{
        const paper=document.querySelector('.paper'),pr=paper.getBoundingClientRect(),footer=document.querySelector('.machine').getBoundingClientRect();
        const collisions=[...paper.children].filter(e=>e.matches('section,header,footer')).map(e=>({tag:e.className,rect:e.getBoundingClientRect()}));
        const machine=document.querySelector('.machine');
        return {overflow:paper.scrollHeight>paper.clientHeight+1||footer.bottom>pr.bottom-10||machine.scrollHeight>machine.clientHeight+1,
          horizontalOverflow:paper.scrollWidth>paper.clientWidth+1,
          prefCount:document.querySelectorAll('[data-prefecture]').length,
          highlighted:document.querySelectorAll('[data-prefecture].visited').length,
          unitCount:document.querySelectorAll('[data-unit]').length,
          unitHighlighted:document.querySelectorAll('[data-unit].visited').length,
          routeCurves:document.querySelectorAll('[data-route]').length,
          labels:document.querySelectorAll('.stamp').length,
          edgeLabels:document.querySelectorAll('[data-edge]').length,
          empty:[...document.querySelectorAll('[data-stat]')].filter(e=>!e.textContent.trim()).length,
          blocks:collisions.map(({tag,rect})=>({tag,top:Math.round(rect.top),bottom:Math.round(rect.bottom)})),
          text:document.body.innerText};
      });
      const requiresEdge=area==='japan'
        ? atlas.routes.some(r=>isRecordedMovement(r)&&r.countries?.includes('日本')&&r.countries.some(c=>c!=='日本'))
        : regional&&(view.border||[]).some(isRecordedMovement);
      if(errors.length||check.overflow||check.horizontalOverflow||check.empty || (regional&&check.unitHighlighted!==regionMaps[area].active) || (requiresEdge&&!check.edgeLabels) || (area==='japan'&&(check.prefCount!==47||check.highlighted!==atlas.japan.visited))||(area==='world'&&check.labels!==atlas.meta.countries))throw new Error(JSON.stringify({area,errors,...check,text:undefined}));
      if(/约\s*\d|计划|已飞|推算|数据来源/.test(check.text))throw new Error('图片出现已要求去除的说明');
      if(social&&forbidden.some(n=>check.text.toLowerCase().includes(n.toLowerCase())))throw new Error('正文有姓名残留');
      const stem=passportStem(area,config,social);
      const asset={kind:area==='world'?'world':'region',name:area==='world'?'全球':area==='japan'?'日本':config.name,variant:social?'分享':'个人'};
      await writeFile(await prepareAsset(passportAsset(output,{...asset,format:'html'})),html);
      await page.locator('#poster').screenshot({path:await prepareAsset(passportAsset(output,asset))});
      delete check.text;checks.push({area,version,...check,mapLabels});
      await page.close();console.log(`已导出 ${passportAsset(output,asset)}`);
    }
  }finally{await browser.close();}
  await writeFile(join(checksDir,'atlas-render-checks.json'),JSON.stringify({meta:atlas.meta,japan:atlas.japan,regions:Object.fromEntries(Object.entries(atlas.regions).map(([k,v])=>[k,v.meta])),checks},null,2)+'\n');
  await annotateManifest(manifestPath(output),{
    render:{generatedAt:new Date().toISOString(),areas:selected,variants:variant==='all'?['personal','social']:[variant],
      images:checks.map(c=>passportAsset('',{kind:c.area==='world'?'world':'region',name:c.area==='world'?'全球':c.area==='japan'?'日本':catalog[c.area].name,variant:c.version==='social'?'分享':'个人'})),checks:checks.length},
  });
  const site=await buildSite({vault,output:join(output,'site'),atlas});
  const cities=site.data.scopes.filter(s=>s.level==='city'&&!s.detailScopeId);
  if(scope==='all'&&variant!=='personal'&&cities.length){
    await exportScopes({data:site.data,scope:cities.map(s=>s.id).join(','),format:'png',output,vault,flowStyle:'solid'});
    await annotateManifest(manifestPath(output),{cityExport:{generatedAt:new Date().toISOString(),images:cities.map(c=>passportAsset('',{kind:c.detailKind==='province'?'region':'city',name:c.name,country:c.countries[0]}))}});
  }
  if(scope==='all'){
    const hasFlights=atlas.routes.some(r=>r.mode==='飞机'&&isRecordedMovement(r)&&!r.candidate&&!r.structuralLink);
    if(hasFlights){
      const flightChecks=await renderFlight({data:flightView(atlas),output,variant});
      await annotateManifest(manifestPath(output),{flightExport:{generatedAt:new Date().toISOString(),images:flightChecks.map(c=>c.png),checks:flightChecks.length}});
    }
    if(variant!=='personal')for(const year of Object.keys((await annualConfig()).years||{}))await renderAnnual({year:Number(year),atlas,output,vault});
  }
  await writeOutputGuide(output);
  return {atlas,checks,site:site.report};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const {values}=parseArgs({options:{vault:{type:'string'},output:{type:'string'},variant:{type:'string',default:'all'},scope:{type:'string',default:'all'},'sync-vault':{type:'boolean',default:false}}});
  renderAtlas({vault:values.vault,output:values.output&&resolve(values.output),variant:values.variant,scope:values.scope,syncVault:values['sync-vault']}).catch(e=>{console.error(e.message);process.exitCode=1;});
}
