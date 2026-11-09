import {readFile,readdir,writeFile,rmdir,mkdtemp,rm} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ROOT} from './data.mjs';
import {passportAsset,writeOutputGuide} from './output-paths.mjs';
const config=JSON.parse(await readFile(join(ROOT,'data/atlas-config.json'))),cities=JSON.parse(await readFile(join(ROOT,'data/city-catalog.json'))),regions=JSON.parse(await readFile(join(ROOT,'data/region-catalog.json')));
const output=config.output,aliases=new Map();
for(const variant of ['分享','个人']){
  for(const [label,kind,name]of [['全球飞行護照','flight','全球'],['全球飞行护照','flight','全球'],['全球旅行护照','world','全球'],['日本旅行护照','region','日本'],...Object.values(regions).map(c=>[c.name+'旅行护照','region',c.name])])aliases.set(label+'-'+variant,{kind,name,variant});
  for(const c of cities)for(const name of [c.name,...c.legacyNames||[]])aliases.set('城市旅行护照-'+name+'-'+variant,{kind:c.detailKind==='province'?'region':'city',name:c.name,country:c.country,variant});
}
const pending=[],oldFolders=[];
// Flatten only generated passport assets, after their current replacements
// exist. Keep the previous directory tree in the recoverable archive.
for(const [parent,format]of [[output,'png'],[join(output,'html'),'html']])for(const root of ['01_全球护照','02_地区护照','03_城市护照']){
  const group=join(parent,root);
  const scan=async(folder,depth=0)=>{let entries;try{entries=await readdir(folder,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
    if(depth)oldFolders.push(folder);
    for(const e of entries){const source=join(folder,e.name);if(e.isDirectory())await scan(source,depth+1);
      else if(depth&&e.isFile()&&e.name.endsWith('.'+format)&&/^(旅行护照|飞行护照)-/.test(e.name)){
        const current=join(group,e.name);await readFile(current);pending.push({source,current});
      }}
  };await scan(group);
}
for(const [folder,format]of [[output,'png'],[join(output,'html'),'html']])for(const name of await readdir(folder)){
  if(!name.endsWith('.'+format))continue;const spec=aliases.get(name.slice(0,-format.length-1));if(!spec)continue;
  const source=join(folder,name),current=passportAsset(output,{...spec,format});await readFile(current); // replacement must exist first
  pending.push({source,current});
}
for(const c of cities)for(const entry of c.entryScopes||[]){
  if(!entry.startsWith('city:'))continue;const old=cities.find(n=>'city:'+n.id===entry);if(!old)continue;
  const source=passportAsset(output,{kind:'city',name:old.name,country:old.country}),current=passportAsset(output,{kind:'city',name:c.name,country:c.country});
  try{await readFile(source);await readFile(current);pending.push({source,current});}catch(e){if(e.code!=='ENOENT')throw e;}
}
const unique=[...new Map(pending.map(p=>[p.source,p])).values()];
if(!process.argv.includes('--apply')){console.log(JSON.stringify({files:unique.length,action:'旧输出经逐文件校验后压缩进private/history；当前替代文件已生成'},null,2));}
else if(unique.length){
  const archive=join(ROOT,'private/history','output-'+new Date().toISOString().replace(/[:.]/g,'-')+'.zip');
  const scratch=await mkdtemp(join(tmpdir(),'travel-archive-'));
  try{
    const plan=join(scratch,'plan.json');
    await writeFile(plan,JSON.stringify({root:output,archive,files:unique.map(p=>relative(output,p.source)),
      reason:'已由当前扁平命名成品替代的旧输出',metadata:{replacements:unique.map(p=>({from:relative(output,p.source),current:relative(output,p.current)}))}}));
    const {stdout}=await promisify(execFile)('python3',[join(ROOT,'scripts/archive-files.py'),'--plan',plan,'--remove']);
    await writeOutputGuide(output);console.log(stdout.trim());
  }finally{await rm(scratch,{recursive:true,force:true});}
  for(const folder of [...new Set(oldFolders)].sort((a,b)=>b.length-a.length))await rmdir(folder).catch(e=>{if(!['ENOTEMPTY','ENOENT'].includes(e.code))throw e;});
}
