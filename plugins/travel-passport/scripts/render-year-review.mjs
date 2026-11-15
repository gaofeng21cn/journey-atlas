import {readFile,writeFile,mkdir,mkdtemp,rename} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve,relative,dirname,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {ROOT,WORKSPACE_ROOT} from './data.mjs';
import {loadYearReview} from './year-review.mjs';
import {reviewPageSvg,reviewPageHtml} from '../src/year-review.mjs';
import {loadReviewAssets} from './year-review-assets.mjs';

export async function retirePreviousReviewFiles(root,dir,previous,manifest){
  if(previous?.schema!==manifest.schema||['year','theme','style','format'].some(k=>previous[k]!==manifest[k]))return null;
  const current=new Set(manifest.files.flatMap(f=>[f.html,f.svg,f.png]).filter(ref=>typeof ref==='string').map(ref=>resolve(root,ref)));
  const obsolete=[...new Set((previous.files||[]).flatMap(f=>[f.html,f.svg,f.png]).filter(ref=>typeof ref==='string').map(ref=>resolve(root,ref)))]
    .filter(file=>dirname(file)===dir&&!current.has(file)&&/^\d{2}-[a-z-]+\.(png|svg|html)$/.test(basename(file)));
  if(!obsolete.length)return null;
  const history=join(root,'_previous',String(manifest.year),`${manifest.theme}-${manifest.style}-${manifest.format}`);
  await mkdir(history,{recursive:true});const archive=await mkdtemp(join(history,'replaced-'));
  for(const file of obsolete)await rename(file,join(archive,basename(file))).catch(e=>{if(e.code!=='ENOENT')throw e;});
  await writeFile(join(archive,'previous-manifest.json'),JSON.stringify(previous,null,2)+'\n');
  return archive;
}

export async function buildReviewGallery(output,models,{mapHref='../site/index.html',defaults={}}={}){
  const assets=await loadReviewAssets();
  const [template,css,bundle]=await Promise.all([readFile(join(ROOT,'src/year-review.html'),'utf8'),readFile(join(ROOT,'src/year-review.css'),'utf8'),build({entryPoints:[join(ROOT,'src/year-review-app.mjs')],bundle:true,write:false,format:'iife',target:'es2022',minify:true})]);
  await mkdir(output,{recursive:true});
  const file=join(output,'index.html');
  await writeFile(file,template.replace('__MAP_HREF__',()=>mapHref).replace('__REVIEW_CSS__',()=>css).replace('__REVIEW_DATA__',()=>JSON.stringify(models).replace(/</g,'\\u003c')).replace('__REVIEW_ASSETS__',()=>JSON.stringify(assets).replace(/</g,'\\u003c')).replace('__REVIEW_DEFAULTS__',()=>JSON.stringify(defaults).replace(/</g,'\\u003c')).replace('__REVIEW_JS__',()=>bundle.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')));
  return file;
}
export async function renderYearReview(options={}){
  const {model,view,config,atlas,curation}=await loadYearReview(options);
  const assets=await loadReviewAssets();
  const root=resolve(options.output||join(config.output||join(WORKSPACE_ROOT,'outputs'),'annual-reviews'));
  const dir=join(root,String(model.year),`${model.theme}-${model.style}-${model.format}`);await mkdir(dir,{recursive:true});
  const previous=await readFile(join(dir,'manifest.json'),'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  const browser=await chromium.launch({headless:true,...(process.env.PASSPORT_BROWSER_CHANNEL?{channel:process.env.PASSPORT_BROWSER_CHANNEL}:existsSync('/Applications/Google Chrome.app')?{channel:'chrome'}:{})});
  const files=[];
  try{
    const page=await browser.newPage({viewport:{width:1200,height:1600},deviceScaleFactor:1});
    for(let i=0;i<model.pages.length;i++){
      const stem=String(i+1).padStart(2,'0')+'-'+model.pages[i].id;
      const html=reviewPageHtml(model,i,{assets}),svg=reviewPageSvg(model,i,{assets});
      await writeFile(join(dir,stem+'.html'),html);await writeFile(join(dir,stem+'.svg'),svg);
      await page.setContent(html);await page.evaluate(()=>document.fonts.ready);
      const clipped=await page.evaluate(()=>[...document.querySelectorAll('svg text')].flatMap(e=>{const b=e.getBBox();return b.x<0||b.y<0||b.x+b.width>1200||b.y+b.height>1600?[e.textContent]:[];}));
      if(clipped.length)throw new Error('年度卡片文字超出画布：'+clipped.join('；'));
      const png=join(dir,stem+'.png');await page.screenshot({path:png});
      files.push({id:model.pages[i].id,html:relative(root,join(dir,stem+'.html')),svg:relative(root,join(dir,stem+'.svg')),png:relative(root,png),sha256:createHash('sha256').update(await readFile(png)).digest('hex')});
    }
  }finally{await browser.close();}
  const manifest={schema:'journey-atlas.year-review-export.v1',year:model.year,theme:model.theme,style:model.style,format:model.format,pageCount:files.length,dimensions:{width:1200,height:1600},includesPlanned:model.travelPolicy.includePlanned,travelMetrics:view.metrics,files,model,generatedAt:new Date().toISOString()};
  await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  await retirePreviousReviewFiles(root,dir,previous,manifest);
  const indexPath=join(root,'index.json');
  let index=await readFile(indexPath,'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return {schema:'journey-atlas.year-reviews.v1',editions:[]};throw e;});
  const entry={year:model.year,theme:model.theme,style:model.style,format:model.format,pageCount:files.length,manifest:relative(root,join(dir,'manifest.json'))};
  index.editions=index.editions.filter(e=>![e.year,e.theme,e.style,e.format].every((v,i)=>v===[entry.year,entry.theme,entry.style,entry.format][i]));index.editions.push(entry);
  await writeFile(indexPath,JSON.stringify(index,null,2)+'\n');
  const years=[...new Set(index.editions.map(e=>e.year))].sort((a,b)=>b-a);const models=[];
  for(const y of years){
    for(const includePlanned of [model.travelPolicy.includePlanned,!model.travelPolicy.includePlanned])models.push((await loadYearReview({atlas,config,year:y,curation:y===model.year?curation:undefined,asOf:y===model.year?options.asOf:undefined,theme:'life',format:'single',includePlanned})).model);
  }
  const gallery=await buildReviewGallery(root,models,{defaults:{year:model.year,theme:model.theme,style:model.style,format:model.format,includePlanned:model.travelPolicy.includePlanned}});
  return {year:model.year,theme:model.theme,style:model.style,format:model.format,pageCount:files.length,directory:dir,gallery,files};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const {values}=parseArgs({options:{year:{type:'string'},'as-of':{type:'string'},output:{type:'string'},theme:{type:'string'},style:{type:'string'},format:{type:'string'},'include-planned':{type:'boolean'},'exclude-planned':{type:'boolean'}}});
  if(!values.year)throw new Error('使用 --year 指定年度');if(values['include-planned']&&values['exclude-planned'])throw new Error('待飞统计选项不能同时开启和关闭');
  console.log(JSON.stringify(await renderYearReview({year:Number(values.year),asOf:values['as-of'],output:values.output,theme:values.theme,style:values.style,format:values.format,includePlanned:values['include-planned']?true:values['exclude-planned']?false:undefined}),null,2));
}
