import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,symlink,rename,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative} from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT} from '../scripts/data.mjs';
import {TABLES,UPDATE_DEFINITIONS} from '../scripts/schema.mjs';
import {csv,loadAtlas} from '../scripts/atlas-data.mjs';
import {resolveSource,sourcePath} from '../scripts/source-data.mjs';
import {validateLinks} from '../scripts/source-references.mjs';
import {sourceManifest} from '../scripts/manifest.mjs';
import {updateSourceSnapshot,applySourceUpdate,inspectUpdate} from '../scripts/update-operation.mjs';
import {updateCities} from '../scripts/update-cities.mjs';

async function fixture(t,{custom=false}={}){
  const root=await mkdtemp(join(tmpdir(),'travel-layout-'));
  const folder=join(root,custom?'records/unchanged-tables':'50_🌍旅行记录/53_整理说明');
  const note=custom?'notes/trip.md':'50_🌍旅行记录/51_行程/trip.md';
  await mkdir(folder,{recursive:true});await mkdir(join(root,note,'..'),{recursive:true});
  await writeFile(join(root,note),'Synthetic trip evidence.\n');
  for(const def of Object.values(UPDATE_DEFINITIONS))await writeFile(join(folder,def.file),csv([],def.headers));
  await writeFile(join(folder,TABLES.visitCandidates),csv([],['地点编号']));
  await writeFile(join(folder,TABLES.cityJourneys),'[]\n');await writeFile(join(folder,TABLES.cityEvidence),'{}\n');
  const files=Object.fromEntries(Object.values(TABLES).map(file=>[file,file]));
  const legacy={vault:root,coverage:[],output:join(root,'outputs')};
  const portable={referenceRoot:root,dataSource:{type:'csv-directory',path:relative(root,folder),files,referenceRoots:[custom?'notes':'50_🌍旅行记录']},coverage:[],output:join(root,'outputs')};
  t.after(()=>rm(root,{recursive:true,force:true}));
  return {root,folder,note,files,legacy,portable};
}

function cli(config,command,args=[]){
  const child=spawnSync(process.execPath,['scripts/passport.mjs',command,...args,'--json'],{cwd:ROOT,encoding:'utf8',env:{...process.env,TRAVEL_PASSPORT_CONFIG:config}});
  assert.equal(child.status,0,child.stderr||child.stdout);
  return JSON.parse(child.stdout);
}

test('legacy and portable bindings read the same unchanged files, identities and revisions',async t=>{
  const f=await fixture(t),old=await resolveSource({config:f.legacy}),portable=await resolveSource({config:f.portable});
  await writeFile(join(f.folder,TABLES.flightArchive),csv([{'证据编号':'FLIGHT-KEEP-ID','记录类型':'已飞','日期标准':'2024-05-01','出发城市':'甲机场','到达城市':'乙机场','出发服务城市':'甲城','到达服务城市':'乙城','出发国家地区':'中国','到达国家地区':'中国','纬度_出发':'30','经度_出发':'120','纬度_到达':'31','经度_到达':'121','统计采用里程公里':'1000','统计里程依据':'航旅纵横导出原值优先','飞行时长分钟':'120','飞行时长依据':'表列当地起降时刻，按机场历史时区与跨日换算；非实际空中时间','航段发生依据':'合成客票','关联正文':f.note}],UPDATE_DEFINITIONS.flightArchive.headers));
  const before=await Promise.all(Object.values(f.files).filter(file=>file!==TABLES.prefectures).map(file=>readFile(join(f.folder,file))));
  const a=await loadAtlas(undefined,{}, {config:f.legacy,source:old});
  const b=await loadAtlas(undefined,{}, {config:f.portable,source:portable});
  assert.deepEqual(JSON.parse(JSON.stringify(b.atlas)),JSON.parse(JSON.stringify(a.atlas)));assert.deepEqual(b.sourceRows,a.sourceRows);
  assert.equal(b.atlas.routes[0].id,'FLIGHT-KEEP-ID');
  assert.deepEqual(await updateSourceSnapshot(f.folder,portable),await updateSourceSnapshot(f.folder,old));
  assert.deepEqual((await sourceManifest(f.folder,undefined,ROOT,portable)).map(({file,sha256})=>({file,sha256})),(await sourceManifest(f.folder,undefined,ROOT,old)).map(({file,sha256})=>({file,sha256})));
  await validateLinks(portable.base,[{'关联正文':f.note}],{source:portable});
  assert.deepEqual(await Promise.all(Object.values(f.files).filter(file=>file!==TABLES.prefectures).map(file=>readFile(join(f.folder,file)))),before);
});

test('public status/check and city preview accept an arbitrary directory without renaming sources',async t=>{
  const f=await fixture(t,{custom:true}),config=join(f.root,'config.json');await writeFile(config,JSON.stringify(f.portable));
  const status=cli(config,'status'),check=cli(config,'check');
  assert.equal(status.source.revision,check.source.revision);
  const source=await resolveSource({config:f.portable});
  await validateLinks(source.base,[{'关联正文':f.note}],{source});
  const before=await updateSourceSnapshot(f.folder,source);
  const preview=await updateCities({source,patch:{version:1,cityJourneys:[],cityEvidence:{}},dryRun:true});
  assert.equal(preview.state,'preview');assert.equal(preview.receipt,null);
  assert.deepEqual(await updateSourceSnapshot(f.folder,source),before);
  assert.deepEqual((await readdir(f.root)).sort(),['config.json','notes','records']);
});

test('mapped Obsidian and portable transactions write and inspect the exact nested file',async t=>{
  const f=await fixture(t,{custom:true});
  await mkdir(join(f.folder,'nested'));await rename(join(f.folder,TABLES.journeys),join(f.folder,'nested/original.csv'));
  const configs=[{vault:f.root,dataSource:{type:'obsidian',path:f.root,tableDirectory:relative(f.root,f.folder),files:{...f.files,[TABLES.journeys]:'nested/original.csv'},referenceRoots:['notes']}},
    {...f.portable,dataSource:{...f.portable.dataSource,files:{...f.files,[TABLES.journeys]:'nested/original.csv'}}}];
  for(const [i,config] of configs.entries()){
    const source=await resolveSource({config}),snapshot=await updateSourceSnapshot(f.folder,source),original=await readFile(sourcePath(source,TABLES.journeys),'utf8');
    const changes=[{file:TABLES.journeys,original,next:original+'\n'}],options={folder:f.folder,source,snapshot,changes,report:{},root:join(f.root,'receipts-'+i),operationId:'mapped-update'};
    const preview=await applySourceUpdate({...options,dryRun:true});assert.equal(preview.state,'preview');
    assert.equal(await readFile(sourcePath(source,TABLES.journeys),'utf8'),original);
    const result=await applySourceUpdate(options);assert.equal(result.files[0].sourcePath,'nested/original.csv');
    assert.equal((await inspectUpdate('mapped-update',{root:options.root})).readback.sourceState,'matches_applied');
    assert.equal((await updateSourceSnapshot(f.folder,source)).revision,result.source.after);
    await assert.rejects(readFile(join(f.folder,TABLES.journeys)),{code:'ENOENT'});
    assert.equal(await readFile(join(result.backup,TABLES.journeys),'utf8'),original);
  }
});

test('source mappings reject traversal, duplicate targets and escaping symlinks before writes',async t=>{
  const f=await fixture(t,{custom:true}),outside=join(f.root,'outside.csv');await writeFile(outside,'preserved');
  for(const type of ['csv-directory','obsidian']){
    const config=type==='csv-directory'?f.portable:{dataSource:{type,path:f.root,tableDirectory:relative(f.root,f.folder),referenceRoots:['notes']}};
    for(const mapping of ['../outside.csv',outside,'C:/outside.csv'])await assert.rejects(resolveSource({config:{...config,dataSource:{...config.dataSource,files:{[TABLES.journeys]:mapping}}}}),/路径无效/);
    await assert.rejects(resolveSource({config:{...config,dataSource:{...config.dataSource,files:{[TABLES.journeys]:'duplicate.csv',[TABLES.ground]:'duplicate.csv'}}}}),/同一文件/);
  }
  await symlink(outside,join(f.folder,'escape.csv'));
  const source={type:'obsidian',folder:f.folder,base:f.root,files:{[TABLES.journeys]:'escape.csv'}};
  await assert.rejects(updateSourceSnapshot(f.folder,source),/不能越出/);
  await assert.rejects(sourceManifest(f.folder,[TABLES.journeys],ROOT,source),/不能越出/);
  await assert.rejects(applySourceUpdate({folder:f.folder,source,snapshot:{revision:'unused'},changes:[],root:join(f.root,'receipts')}),/不能越出/);
  assert.equal(await readFile(outside,'utf8'),'preserved');
  await assert.rejects(readdir(join(f.root,'receipts')),{code:'ENOENT'});
});

test('body links stay within declared roots, including real symlink destinations',async t=>{
  const f=await fixture(t,{custom:true}),source=await resolveSource({config:f.portable});
  await writeFile(join(f.root,'other.md'),'outside allowed notes');
  await symlink(join(f.root,'other.md'),join(f.root,'notes/escape.md'));
  for(const link of ['notes/../other.md','other.md','notes/escape.md'])await assert.rejects(validateLinks(f.root,[{'关联正文':link}],{source}),/路径无效|允许的来源目录/);
  const outside=await mkdtemp(join(tmpdir(),'travel-outside-'));t.after(()=>rm(outside,{recursive:true,force:true}));
  await writeFile(join(outside,'note.md'),'outside source root');await symlink(outside,join(f.root,'notes/external'));
  await assert.rejects(validateLinks(f.root,[{'关联正文':'notes/external/note.md'}],{source}),/不能越出/);
});


test('storage preserves legacy body coverage and counts only distinct declared portable roots',async t=>{
  for(const custom of [false,true]){
    const f=await fixture(t,{custom}),config=custom?f.portable:f.legacy;
    await writeFile(join(f.root,'unrelated-private.md'),'not part of the travel inventory');
    if(custom)config.dataSource.referenceRoots.push('notes');
    const configPath=join(f.root,'config.json');await writeFile(configPath,JSON.stringify(config));
    const child=spawnSync(process.execPath,['scripts/storage.mjs'],{cwd:ROOT,encoding:'utf8',env:{...process.env,TRAVEL_PASSPORT_CONFIG:configPath}});
    assert.equal(child.status,0,child.stderr||child.stdout);
    const inventory=JSON.parse(child.stdout).usage.vault;
    assert.equal(inventory.files,(await readdir(f.folder)).length+1);
    const resolved=await resolveSource({config});assert.deepEqual(inventory.paths,resolved.storageRoots);
    assert.equal(inventory.paths.length,custom?2:1);
    if(custom){const implicit=await resolveSource({config:{...config,dataSource:{...config.dataSource,referenceRoots:undefined}}});assert.deepEqual(implicit.storageRoots,[await realpath(f.folder)]);}
  }
});

test('public update preview, apply and receipt preserve mapped source ownership',async t=>{
  const f=await fixture(t,{custom:true}),config=join(f.root,'config.json'),input=join(f.root,'update.json');
  await mkdir(join(f.folder,'nested'));await rename(join(f.folder,TABLES.cityJourneys),join(f.folder,'nested/trips.json'));
  f.portable.dataSource.files[TABLES.cityJourneys]='nested/trips.json';
  await writeFile(config,JSON.stringify(f.portable));
  const journey={id:'SYNTHETIC-TRIP',cityId:'tokyo',first:'2024-05-01',last:'2024-05-02',source:f.note};
  await writeFile(input,JSON.stringify({version:1,cityJourneys:[journey]}));
  const preview=cli(config,'update',['--input',input,'--dry-run']);assert.equal(preview.state,'preview');
  assert.deepEqual(JSON.parse(await readFile(join(f.folder,'nested/trips.json'),'utf8')),[]);
  const operationId='layout-'+process.pid+'-'+Date.now();
  const applied=cli(config,'update',['--input',input,'--no-render','--operation-id',operationId,'--expected-source-revision',preview.source.before]);
  t.after(async()=>{await rm(applied.receipt,{force:true});if(applied.backup)await rm(applied.backup,{recursive:true,force:true});});
  assert.equal(applied.state,'completed');
  assert.deepEqual(JSON.parse(await readFile(join(f.folder,'nested/trips.json'),'utf8')),[journey]);
  assert.equal(applied.files.find(file=>file.file===TABLES.cityJourneys).sourcePath,'nested/trips.json');
  const receipt=cli(config,'receipt',['--id',operationId]);assert.equal(receipt.readback.sourceState,'matches_applied');
  assert.equal(cli(config,'status').build.state,'fresh');
  await assert.rejects(readFile(join(f.folder,TABLES.cityJourneys)),{code:'ENOENT'});
});
