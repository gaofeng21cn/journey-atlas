import {readAtlasConfig,resolveSource} from './source-data.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {chromium} from 'playwright';
import {ROOT,readJson} from './data.mjs';
import {loadAtlas} from './atlas-data.mjs';
import {annualView} from './annual-data.mjs';
import {annualMap} from './annual-map.mjs';
import {writeOutputGuide} from './output-paths.mjs';
import {annotateManifest,manifestPath} from './manifest.mjs';
import {validateLinks} from './source-references.mjs';

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>n.toLocaleString('en-US'),mrz=s=>{if(s.length>44)throw new Error('年度机读区超过44字符');return esc(s.padEnd(44,'<'));};
export async function annualConfig(){return readJson(join(ROOT,'data/annual-config.json')).catch(e=>{if(e.code==='ENOENT')return {years:{}};throw e;});}

export async function renderAnnual({year,asOf,output,vault,atlas}={}){
  const config=await readAtlasConfig(),curation=(await annualConfig()).years?.[year]||{};
  const source=await resolveSource({vault,config});
  output ||= config.output;
  atlas ||= (await loadAtlas(undefined,{}, {source})).atlas;
  const basePlaceId=curation.basePlaceId||atlas.journeyLayer.journeys.filter(j=>j.date.startsWith(String(year)))
    .map(j=>j.baseId).filter(Boolean).sort((a,b)=>atlas.journeyLayer.journeys.filter(j=>j.baseId===b).length-atlas.journeyLayer.journeys.filter(j=>j.baseId===a).length)[0];
  const view=annualView(atlas,{year,asOf:asOf||curation.asOf||`${year}-12-31`,basePlaceId,placeGroups:curation.placeGroups||[]});
  if(!view.farthest)throw new Error('该年度暂无已核地面到访记录，无法生成年度卡');
  const memory=curation.memory;
  if(memory){
    if(!view.places.some(p=>p.id===memory.placeId))throw new Error('年度记忆须引用本年度实际到访地点');
    await validateLinks(source.base,[{'关联正文':memory.source}],{source});
  }
  const dotText=await readFile(join(ROOT,'src/world-dots.js'),'utf8'),dots=JSON.parse(dotText.slice(dotText.indexOf('=')+1).trim().replace(/;$/,''));
  const labels=curation.mapLabels||[{placeId:view.base.id,dx:-30,dy:45},{placeId:view.farthest.id,dx:0,dy:-26,caption:'年度最远'}];
  const map=annualMap(view,dots,{labels});
  const firstCountry=view.newCountries[0],newPlace=view.places.filter(p=>p.country===firstCountry).sort((a,b)=>a.first.localeCompare(b.first))[0]||view.newCities[0];
  const fallback=view.revisits[0],period='01.01 — '+view.dataThrough.slice(5).replace('-','.');
  const [template,css]=await Promise.all([readFile(join(ROOT,'src/annual.html'),'utf8'),readFile(join(ROOT,'src/annual.css'),'utf8')]);
  const values={YEAR:year,CSS:css,MAP:map.svg,PERIOD:period,COUNTRY_NAMES:esc(view.countries.join('  ·  ')),KM:fmt(view.metrics.totalKm),EARTH:view.metrics.earth.toFixed(1),COUNTRIES:view.metrics.countries,CITIES:view.metrics.cities,FLIGHT_HOURS:fmt(view.metrics.flightHours),
    NEW_LABEL:firstCountry?'新点亮的国家':'新抵达的城市',NEW_TITLE:esc(firstCountry||newPlace?.name||'继续出发'),
    NEW_BODY:firstCountry?`第一次走进${esc(newPlace.name)}，<br>点亮一片新的地图。`:`${view.metrics.newCities}座新城市，<br>让这一年的地图更丰富。`,
    NEW_FOOT:esc(newPlace?newPlace.first.slice(5).replace('-','.')+' · '+newPlace.name:''),
    FARTHEST:esc(view.farthest.name),FAR_KM:fmt(view.farthest.km),BASE:esc(view.base.name),
    MEMORY_TITLE:esc(memory?.title||fallback?.country||'在路上的日子'),MEMORY_BODY:memory?memory.body.map(esc).join('<br>'):`${fallback?.trips||0}次旅行，<br>继续探索熟悉的远方。`,MEMORY_FOOT:esc(memory?.foot||''),
    MRZ_1:mrz(`P<CHN<MY<TRAVEL<YEARBOOK<${year}`),MRZ_2:mrz(`${year}<${view.metrics.totalKm}KM<${view.metrics.countries}COUNTRIES<${view.metrics.cities}CITIES`)};
  const html=template.replace(/\{\{(\w+)\}\}/g,(_,key)=>values[key]??'');
  const stem=`年度旅行卡-${year}-分享`,htmlPath=join(output,'html/01_全球护照',stem+'.html'),pngPath=join(output,'01_全球护照',stem+'.png');
  await mkdir(join(output,'html/01_全球护照'),{recursive:true});await mkdir(join(output,'01_全球护照'),{recursive:true});await mkdir(join(output,'checks'),{recursive:true});await mkdir(join(output,'data'),{recursive:true});
  const browser=await chromium.launch({channel:'chrome',headless:true});
  let checks;
  try{
    const page=await browser.newPage({viewport:{width:1120,height:1494},deviceScaleFactor:2});
    await page.setContent(html);await page.evaluate(()=>document.fonts.ready);
    checks=await page.evaluate(()=>{
      const poster=document.getElementById('poster'),paper=document.querySelector('.paper'),svg=document.querySelector('.map-figure svg'),b=svg.getBoundingClientRect();
      const labels=[...svg.querySelectorAll('.map-label text')].map(e=>({text:e.textContent,rect:e.getBoundingClientRect().toJSON()}));
      const clipped=labels.filter(({rect:r})=>r.x<b.x||r.right>b.right||r.y<b.y||r.bottom>b.bottom).map(l=>l.text);
      const overlaps=[];for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){const a=labels[i].rect,c=labels[j].rect;if(a.x<c.right&&c.x<a.right&&a.y<c.bottom&&c.y<a.bottom)overlaps.push([labels[i].text,labels[j].text]);}
      return {width:poster.clientWidth,height:poster.clientHeight,overflow:paper.scrollHeight>paper.clientHeight,clipped,overlaps,mrz:[...document.querySelectorAll('.machine span')].map(e=>e.textContent.length),mapRoutes:svg.querySelectorAll('.route').length};
    });
    if(checks.overflow||checks.clipped.length||checks.overlaps.length)throw new Error('年度卡版面检查失败：'+JSON.stringify(checks));
    await page.locator('#poster').screenshot({path:pngPath});
  }finally{await browser.close();}
  await writeFile(htmlPath,html);
  const summary={...view,routes:undefined,sourceRoutes:view.routes.map(r=>r.id),memory:memory||null,map:{segments:map.segments,nodes:map.nodes,bounds:map.bounds},checks};
  await writeFile(join(output,'data',`年度旅行摘要-${year}.json`),JSON.stringify(summary,null,2)+'\n');
  await writeFile(join(output,'checks',`年度旅行卡-${year}-检查.json`),JSON.stringify({generatedAt:new Date().toISOString(),year,dataThrough:view.dataThrough,metrics:view.metrics,...checks},null,2)+'\n');
  await writeOutputGuide(output);
  const saved=await readJson(manifestPath(output)).catch(e=>{if(e.code==='ENOENT')return {};throw e;});
  const years={...saved.annualExport?.years,[year]:{image:`01_全球护照/${stem}.png`,summary:`data/年度旅行摘要-${year}.json`}};
  await annotateManifest(manifestPath(output),{annualExport:{years,images:Object.values(years).map(y=>y.image),summaries:Object.values(years).map(y=>y.summary)}});
  return {year,png:pngPath,html:htmlPath,metrics:view.metrics,dataThrough:view.dataThrough,checks};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const {values}=parseArgs({options:{year:{type:'string'},'as-of':{type:'string'},output:{type:'string'}}});
  if(!values.year)throw new Error('使用 --year 指定年度');
  console.log(JSON.stringify(await renderAnnual({year:Number(values.year),asOf:values['as-of'],output:values.output}),null,2));
}
