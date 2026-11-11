import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve,relative,sep} from 'node:path';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {build} from 'esbuild';
import {ROOT,readJson,WORKSPACE_ROOT} from './data.mjs';
import {readAtlasConfig} from './source-data.mjs';
import {prepareSiteData} from './site-data.mjs';
import {createScopeEngine} from '../src/scope-model.mjs';
import {passportSvg} from '../src/site-map.mjs';
import {travelTime} from '../src/transport-time.mjs';
import {csv} from './csv.mjs';
import {passportAsset,prepareAsset} from './output-paths.mjs';
import {writeCityReconstructions} from './city-reconstruction-output.mjs';

export async function buildSite({vault,output,atlas}={}) {
  const started=performance.now(),config=await readAtlasConfig();
  output=resolve(output||join(config.output||join(WORKSPACE_ROOT,'outputs'),'site'));
  const reconstructionOutput=output===resolve(join(config.output||join(WORKSPACE_ROOT,'outputs'),'site'))?join(output,'..','data'):join(output,'data');
  const [data,template,css,bundle]=await Promise.all([
    prepareSiteData({vault,atlas,onCityDetails:detail=>writeCityReconstructions(detail,reconstructionOutput)}),readFile(join(ROOT,'src/site.html'),'utf8'),readFile(join(ROOT,'src/site.css'),'utf8'),
    build({entryPoints:[join(ROOT,'src/site-app.mjs')],bundle:true,write:false,minify:true,format:'iife',target:'es2022'})]);
  const html=template.replace('__SITE_CSS__',()=>css).replace('__SITE_DATA__',()=>JSON.stringify(data).replace(/</g,'\\u003c'))
    .replace('__SITE_JS__',()=>bundle.outputFiles[0].text.replace(/<\/script/gi,'<\\/script'));
  await mkdir(output,{recursive:true});await writeFile(join(output,'index.html'),html);
  await mkdir(join(output,'data'),{recursive:true});
  await writeFile(join(output,'data','交通移动时长.csv'),csv(data.routes.map(r=>{const t=travelTime(r);return {
    '交通编号':r.id,'交通方式':r.mode,'里程公里':r.km,'时长分钟':t.minutes??'','时长采用来源':t.minutes===null?'待补':t.estimated?'方式模型':'已有记录','时长依据':t.basis};})));
  const engine=createScopeEngine(data),scopes=data.scopes.map(s=>({id:s.id,name:s.name,level:s.level,...engine.query(s.id).stats}));
  const report={generatedAt:new Date().toISOString(),bytes:Buffer.byteLength(html),scopes:scopes.length,
    routes:data.routes.length,places:data.places.length,buildMs:Math.round(performance.now()-started),output:join(output,'index.html')};
  await writeFile(join(output,'build-check.json'),JSON.stringify({...report,views:scopes},null,2)+'\n');
  console.log(JSON.stringify(report,null,2));return {data,output,report};
}

export async function exportScopes({scope='all',output,vault,format='svg',data,flowStyle}={}) {
  if(!['svg','png'].includes(format))throw new Error('导出格式须为svg或png');
  const config=await readAtlasConfig();data||=await prepareSiteData({vault});const engine=createScopeEngine(data);
  output=output|| (format==='png'?config.output:join(config.output,'site','passports'));await mkdir(output,{recursive:true});
  const ids=[...new Set((scope==='all'?data.scopes.filter(s=>!s.detailScopeId&&engine.isVisible(s.id)&&engine.query(s.id).places.length).map(s=>s.id):scope.split(',')).map(engine.resolve))];
  let browser,page;if(format==='png'){const {chromium}=await import('playwright');browser=await chromium.launch({headless:true,...(process.env.PASSPORT_BROWSER_CHANNEL?{channel:process.env.PASSPORT_BROWSER_CHANNEL}:existsSync('/Applications/Google Chrome.app')?{channel:'chrome'}:{})});page=await browser.newPage({viewport:{width:1120,height:1494},deviceScaleFactor:2});}
  const start=performance.now();try{for(const id of ids){const view={...engine.query(id),...flowStyle?{flowStyle}:{}},name=view.scope.name.replace(/[\/\\:]/g,'-'),svg=passportSvg(data,engine,view);
    if(format==='svg')await writeFile(join(output,name+'旅行护照-分享.svg'),svg);
    else{await page.setContent('<style>html,body{margin:0;width:1120px;height:1494px;overflow:hidden}</style>'+svg);await page.evaluate(()=>document.fonts.ready);const path=await prepareAsset(passportAsset(output,{kind:view.scope.detailKind==='province'?'region':view.scope.cityId?'city':'region',name,country:view.scope.countries?.[0]}));await page.screenshot({path});}
  }}finally{await browser?.close();}
  const report={exported:ids.length,ms:Math.round(performance.now()-start),output};console.log(JSON.stringify(report,null,2));return report;
}

async function serve(options){
  const {output}=await buildSite(options),port=options.port||4173;
  const server=createServer(async(req,res)=>{
    try{
      const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname),path=resolve(output,'.'+(name==='/'?'/index.html':name));
      const rel=relative(output,path);if(rel==='..'||rel.startsWith('..'+sep)){res.writeHead(403);res.end();return;}
      const body=await readFile(path);res.setHeader('Content-Type',path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.json')?'application/json':'image/svg+xml');
      res.setHeader('Cache-Control','no-cache');res.setHeader('X-Content-Type-Options','nosniff');res.end(body);
    }catch{res.writeHead(404);res.end('Not found');}
  });
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);});
  console.log(`旅行地图已启动：http://127.0.0.1:${port}`);
}

async function main(){
  const {values,positionals}=parseArgs({allowPositionals:true,options:{vault:{type:'string'},output:{type:'string'},scope:{type:'string',default:'all'},format:{type:'string',default:'svg'},port:{type:'string',default:'4173'}}});
  const options={...values,port:Number(values.port)},command=positionals[0]||'serve';
  if(command==='serve')await serve(options);
  else if(command==='build')await buildSite(options);
  else if(command==='export')await exportScopes(options);
  else if(command==='check'){
    const data=await prepareSiteData(options),engine=createScopeEngine(data),start=performance.now();
    for(const s of data.scopes){const v=engine.query(s.id);if(!Number.isFinite(v.stats.km)||v.stats.km<0||v.stats.visited>v.stats.total)throw new Error('分区统计无效：'+s.id);}
    console.log(JSON.stringify({scopes:data.scopes.length,queryAllMs:Math.round(performance.now()-start),globalKm:engine.query('world').stats.km},null,2));
  }else throw new Error('site 支持 serve/build/check/export');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
