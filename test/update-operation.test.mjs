import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {TABLES} from '../scripts/schema.mjs';
import {ROOT} from '../scripts/data.mjs';
import {reviewArtifact} from '../scripts/passport.mjs';
import {updateSourceSnapshot,requireSourceRevision,applySourceUpdate,inspectUpdate,finishUpdate} from '../scripts/update-operation.mjs';

async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'passport-update-')),folder=join(root,'vault');
  await mkdir(folder);t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(folder,TABLES.journeys),'before\n');
  return {root,folder,snapshot:await updateSourceSnapshot(folder),changes:[{file:TABLES.journeys,original:'before\n',next:'after\n'}],report:{changes:{journeys:{updated:1}}},operationId:'reviewed-change'};
}

test('preview returns the exact source revision and creates no receipt or backup',async t=>{
  const f=await fixture(t),result=await applySourceUpdate({...f,dryRun:true});
  assert.equal(result.state,'preview');assert.equal(result.source.before,f.snapshot.revision);
  assert.notEqual(result.source.after,result.source.before);
  assert.equal(await readFile(join(f.folder,TABLES.journeys),'utf8'),'before\n');
  assert.deepEqual(await readdir(f.root),['vault']);
});

test('an edited source invalidates the reviewed revision before any write',async t=>{
  const f=await fixture(t);await writeFile(join(f.folder,TABLES.journeys),'another owner\n');
  assert.throws(()=>requireSourceRevision({revision:'new'},f.snapshot.revision),{code:'STALE_SOURCE'});
  await assert.rejects(applySourceUpdate(f),{code:'STALE_SOURCE'});
  assert.equal(await readFile(join(f.folder,TABLES.journeys),'utf8'),'another owner\n');
  assert.deepEqual(await readdir(f.root),['vault']);
});

test('apply persists exact hashes and a reused operation cannot repeat a write',async t=>{
  const f=await fixture(t),applied=await applySourceUpdate(f);
  assert.equal(applied.state,'source_applied');
  assert.equal(applied.source.after,(await updateSourceSnapshot(f.folder)).revision);
  const done=await finishUpdate(applied,{artifacts:[{kind:'build_manifest',path:join(f.root,'manifest.json')}]});
  assert.equal(done.state,'completed');
  const readback=await inspectUpdate(f.operationId,{root:f.root});
  assert.equal(readback.readback.sourceState,'matches_applied');assert.equal(readback.nextAction,'none');
  await assert.rejects(applySourceUpdate({...f,snapshot:await updateSourceSnapshot(f.folder),changes:[]}),{code:'OPERATION_EXISTS'});
  assert.equal(await readFile(join(f.folder,TABLES.journeys),'utf8'),'after\n');
  assert.equal(await readFile(join(applied.backup,TABLES.journeys),'utf8'),'before\n');
});

test('a failed build retains applied sources and directs readback to build only',async t=>{
  const f=await fixture(t),applied=await applySourceUpdate(f);
  const result=await finishUpdate(applied,{error:new Error('renderer unavailable')});
  assert.equal(result.ok,false);assert.equal(result.state,'applied_build_failed');
  const readback=await inspectUpdate(f.operationId,{root:f.root});
  assert.equal(readback.readback.sourceState,'matches_applied');assert.equal(readback.nextAction,'build');
  assert.equal(await readFile(join(f.folder,TABLES.journeys),'utf8'),'after\n');
});

test('interrupted and subsequently changed outcomes remain read-only reconciliation',async t=>{
  const f=await fixture(t),result=await applySourceUpdate(f);
  await writeFile(result.receipt,JSON.stringify({...result,state:'applying'}));
  assert.equal((await inspectUpdate(f.operationId,{root:f.root})).nextAction,'reconcile');
  await writeFile(join(f.folder,TABLES.journeys),'newer writer\n');
  const observed=await inspectUpdate(f.operationId,{root:f.root});
  assert.equal(observed.readback.sourceState,'diverged');assert.equal(observed.nextAction,'reconcile');
  assert.equal(await readFile(join(f.folder,TABLES.journeys),'utf8'),'newer writer\n');
});

test('both public update entries return one JSON error and a failing exit code',()=>{
  for(const argv of [['scripts/passport.mjs','update','--json'],['scripts/update-atlas.mjs','--json']]){
    const child=spawnSync(process.execPath,argv,{cwd:ROOT,encoding:'utf8'});
    assert.equal(child.status,1);const result=JSON.parse(child.stdout);
    assert.equal(result.ok,false);assert.equal(result.state,'rejected');assert.equal(result.receipt,null);
  }
});


test('a changed patch is rejected before loading a vault or creating a receipt',async t=>{
  const f=await fixture(t),input=join(f.root,'patch.json');
  await writeFile(input,JSON.stringify({version:1}));
  const child=spawnSync(process.execPath,['scripts/passport.mjs','update','--input',input,'--expected-input-sha256','old-reviewed-hash','--json'],{cwd:ROOT,encoding:'utf8'});
  assert.equal(child.status,1);const result=JSON.parse(child.stdout);
  assert.equal(result.error.code,'STALE_INPUT');assert.equal(result.receipt,null);
});


test('map references verify their own bytes and never inherit data freshness',async t=>{
  const f=await fixture(t),map=join(f.root,'map.html');
  assert.equal((await reviewArtifact('map',map)).state,'missing');
  await writeFile(map,'old map');const old=await reviewArtifact('map',map);
  assert.equal(old.state,'available');assert.equal(old.revision.length,64);
  await writeFile(map,'new map');assert.notEqual((await reviewArtifact('map',map)).revision,old.revision);
});
