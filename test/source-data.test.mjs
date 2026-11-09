import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeDataSource, importSourceBundle, resolveSource } from '../scripts/source-data.mjs';
import {loadAtlas} from '../scripts/atlas-data.mjs';
import {sourceManifest} from '../scripts/manifest.mjs';
import {execFileSync} from 'node:child_process';
import {ROOT} from '../scripts/data.mjs';

test('portable source initializer creates a schema-only bundle without an Obsidian vault', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-passport-source-'));
  try {
    const result = await initializeDataSource({ workspaceRoot: root, sourceDir: 'data/source', writeConfig: true });
    assert.equal(result.type, 'csv-directory');
    assert.ok(result.initializedFiles.includes('movements.csv'));
    const source = await resolveSource({ root });
    assert.equal(source.type, 'csv-directory');
    assert.equal(source.folder, join(root, 'data/source'));
    assert.match(await readFile(join(root, 'data/atlas-config.json'), 'utf8'), /csv-directory/);
    const config=JSON.parse(await readFile(join(root,'data/atlas-config.json'),'utf8'));
    const {atlas}=await loadAtlas(undefined,{}, {source,config});
    assert.equal(atlas.meta.totalKm,0);assert.equal(atlas.routes.length,0);
    const manifest=await sourceManifest(source.folder,undefined,root,source);
    assert.ok(manifest.some(item=>item.file==='source/flights.csv'));
    assert.ok(manifest.some(item=>item.file==='source/movements.csv'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('portable bundle import keeps stable ids and rejects an accidental overwrite', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-passport-import-'));
  const row = { '证据编号': 'F-1', '记录类型': '已飞', '日期': '2024-01-01' };
  try {
    await importSourceBundle({ workspaceRoot: root, sourceDir: 'data/source', bundle: { version: 1, flightArchive: [row] } });
    await assert.rejects(importSourceBundle({ workspaceRoot: root, sourceDir: 'data/source', bundle: { version: 1, flightArchive: [{ ...row, 日期: '2024-01-02' }] } }), /编号已存在且内容不同/);
    await importSourceBundle({ workspaceRoot: root, sourceDir: 'data/source', replace: true, bundle: { version: 1, flightArchive: [{ ...row, 日期: '2024-01-02' }] } });
    assert.match(await readFile(join(root, 'data/source', 'flights.csv'), 'utf8'), /2024-01-02/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('portable workspace runs the real status, source check and site build entries', async () => {
  const root=await mkdtemp(join(tmpdir(),'journey-portable-cli-'));
  try{
    await initializeDataSource({workspaceRoot:root,writeConfig:true});
    const env={...process.env,TRAVEL_PASSPORT_CONFIG:join(root,'data/atlas-config.json')};
    const run=args=>execFileSync(process.execPath,args,{cwd:ROOT,env,encoding:'utf8'});
    assert.equal(JSON.parse(run(['scripts/passport.mjs','status','--json'])).sharing.totalKm,0);
    assert.equal(JSON.parse(run(['scripts/passport.mjs','check','--json'])).locations.records,0);
    const site=JSON.parse(run(['scripts/site.mjs','build']));
    assert.equal(site.routes,0);assert.ok(site.output.startsWith(root));
  }finally{await rm(root,{recursive:true,force:true});}
});
