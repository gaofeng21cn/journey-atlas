import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { feature } from 'topojson-client';
import { toTopology } from '../scripts/prepare-open-geography.mjs';
import { ROOT } from '../scripts/data.mjs';

const exec = promisify(execFile);

test('unquantized public topology preserves polygon holes and multi-polygons', () => {
  const collection = [{ type:'Feature', id:'A', properties:{name:'A'}, geometry:{type:'Polygon',coordinates:[
    [[0,0],[2,0],[2,2],[0,2],[0,0]], [[.5,.5],[.5,1],[1,1],[1,.5],[.5,.5]],
  ]}}, {type:'Feature',id:'B',properties:{name:'B'},geometry:{type:'MultiPolygon',coordinates:[
    [[[3,0],[4,0],[4,1],[3,1],[3,0]]], [[[5,0],[6,0],[6,1],[5,1],[5,0]]],
  ]}}];
  const topology=toTopology(collection,'regions');
  const restored=feature(topology,topology.objects.regions);
  assert.deepEqual(restored.features,collection);
  assert.equal(topology.transform,undefined);
});

test('public geography checker maps every Japanese, Swiss and Chinese catalogue unit without writing', async () => {
  const directory = await mkdtemp(join(tmpdir(),'journey-geography-check-'));
  try {
    const {stdout}=await exec(process.execPath,[join(ROOT,'scripts/prepare-open-geography.mjs'),'--check','--output',directory],{cwd:ROOT});
    const report=JSON.parse(stdout);
    assert.deepEqual(report.layers,{japan:47,switzerland:26,china:34});
    assert.equal(report.ok,true);
    assert.deepEqual(await readdir(directory),[]);
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test('public geography generation writes only four declared boundaries and its source report', async () => {
  const directory = await mkdtemp(join(tmpdir(),'journey-geography-output-'));
  try {
    await exec(process.execPath,[join(ROOT,'scripts/prepare-open-geography.mjs'),'--output',directory],{cwd:ROOT});
    assert.deepEqual((await readdir(directory)).sort(),['china.geojson','japan.topojson','open-geography-report.json','swiss-cantons.topojson','switzerland.geojson']);
    const japan=JSON.parse(await readFile(join(directory,'japan.topojson'),'utf8'));
    const swiss=JSON.parse(await readFile(join(directory,'swiss-cantons.topojson'),'utf8'));
    assert.equal(feature(japan,japan.objects.japan).features.length,47);
    assert.deepEqual(feature(japan,japan.objects.japan).features.map(f=>f.properties.id),Array.from({length:47},(_,i)=>i+1));
    assert.equal(feature(swiss,swiss.objects.cantons).features.length,26);
    assert.equal(JSON.parse(await readFile(join(directory,'china.geojson'),'utf8')).features.length,34);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
