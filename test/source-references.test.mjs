import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {csv} from '../scripts/csv.mjs';
import {validateLinks,referencedEvidenceFiles} from '../scripts/source-references.mjs';
import {sourceManifest} from '../scripts/manifest.mjs';
import {TABLES} from '../scripts/schema.mjs';

test('证据迁移断链会阻止更新，票据编号和照片UUID仍按原语义保留',async()=>{
  const root=await mkdtemp(join(tmpdir(),'travel-reference-'));
  try{
    await mkdir(join(root,'private/evidence'),{recursive:true});
    await writeFile(join(root,'private/evidence/review.json'),'{}');
    const row={'证据引用':'private/evidence/review.json#MOVE-1；photo:UUID-1；邮件:receipt-1'};
    assert.deepEqual(referencedEvidenceFiles([row,row],{root}),['private/evidence/review.json']);
    await validateLinks(root,[row],{root});
    await rename(join(root,'private/evidence/review.json'),join(root,'private/evidence/moved.json'));
    await assert.rejects(validateLinks(root,[row],{root}),/证据文件不存在/);
    await assert.rejects(validateLinks(root,[{'证据引用':'private/../../../escape.json'}],{root}),/不能越出/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('核定证据文件变化参加构建指纹，不能让旧图片继续显示fresh',async()=>{
  const root=await mkdtemp(join(tmpdir(),'travel-reference-')),folder=join(root,'vault');
  try{
    await mkdir(folder);await mkdir(join(root,'private/evidence'),{recursive:true});
    await writeFile(join(root,'private/evidence/review.json'),'original');
    await writeFile(join(folder,TABLES.cityMoves),csv([{'移动编号':'MOVE-1','证据引用':'private/evidence/review.json#MOVE-1'}]));
    const before=await sourceManifest(folder,[],root);
    await writeFile(join(root,'private/evidence/review.json'),'reviewed');
    const after=await sourceManifest(folder,[],root);
    assert.equal(before.find(f=>f.file==='vault/'+TABLES.cityMoves).sha256,after.find(f=>f.file==='vault/'+TABLES.cityMoves).sha256);
    assert.notEqual(before.find(f=>f.file==='app/private/evidence/review.json').sha256,after.find(f=>f.file==='app/private/evidence/review.json').sha256);
  }finally{await rm(root,{recursive:true,force:true});}
});
