import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readdir,rm,symlink,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pruneCache} from '../scripts/prune-cache.mjs';

test('公共地图缓存只清理已知可重建目录',async()=>{
  const root=await mkdtemp(join(tmpdir(),'travel-cache-')),cache=join(root,'data/site-cache');
  try{
    await mkdir(join(cache,'public-geography'),{recursive:true});
    await mkdir(join(cache,'public-tiles'),{recursive:true});
    await mkdir(join(cache,'keep-private'),{recursive:true});
    await writeFile(join(cache,'public-geography','world.json'),'123');
    await writeFile(join(cache,'public-tiles','tile.json'),'4567');
    await writeFile(join(cache,'keep-private','evidence.json'),'personal');
    const report=await pruneCache({root,kinds:['public-geography','public-tiles']});
    assert.equal(report.removedBytes,7);
    assert.deepEqual((await readdir(cache)).sort(),['keep-private']);
    await assert.rejects(pruneCache({root,kinds:['../private']}),/只允许清理/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('公共地图缓存 dry-run 不改动磁盘',async()=>{
  const root=await mkdtemp(join(tmpdir(),'travel-cache-')),cache=join(root,'data/site-cache/public-geography');
  try{
    await mkdir(cache,{recursive:true});await writeFile(join(cache,'world.json'),'123');
    const report=await pruneCache({root,kinds:['public-geography'],apply:false});
    assert.equal(report.removedBytes,3);
    assert.deepEqual(await readdir(cache),['world.json']);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('浏览器诊断只保留最近一批，清理不会触及稳定核定证据',async()=>{
  const root=await mkdtemp(join(tmpdir(),'travel-cache-'));
  try{
    await mkdir(join(root,'private/runtime/browser-checks'),{recursive:true});
    await mkdir(join(root,'private/evidence'),{recursive:true});
    await writeFile(join(root,'private/runtime/browser-checks','old.png'),'regenerable');
    await writeFile(join(root,'private/evidence','review.json'),'evidence');
    const report=await pruneCache({root,kinds:['browser-checks']});
    assert.equal(report.removedBytes,11);
    assert.equal(await readFile(join(root,'private/evidence/review.json'),'utf8'),'evidence');
    await assert.rejects(readdir(join(root,'private/runtime/browser-checks')),e=>e.code==='ENOENT');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('清理范围拒绝原型属性名及指向证据目录的符号链接',async()=>{
  const root=await mkdtemp(join(tmpdir(),'travel-cache-'));
  try{
    await mkdir(join(root,'data/site-cache'),{recursive:true});
    await mkdir(join(root,'private/evidence'),{recursive:true});
    await writeFile(join(root,'private/evidence/keep.json'),'evidence');
    await symlink(join(root,'private/evidence'),join(root,'data/site-cache/public-tiles'),'dir');
    await assert.rejects(pruneCache({root,kinds:['constructor']}),/只允许清理/);
    await assert.rejects(pruneCache({root,kinds:['public-tiles']}),/不是目录/);
    assert.equal(await readFile(join(root,'private/evidence/keep.json'),'utf8'),'evidence');
  }finally{await rm(root,{recursive:true,force:true});}
});
