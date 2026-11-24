import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {retirePreviousReviewFiles} from '../plugins/travel-passport/scripts/render-year-review.mjs';

test('页型变化后只移走上一清单中的旧生成页，保留当前页、自有文件及目录外资料',async()=>{
  const root=await mkdtemp(join(tmpdir(),'review-export-')),dir=join(root,'2026/life-night-story');
  await mkdir(dir,{recursive:true});
  try{
    for(const [file,text]of [['01-cover.png','new'],['05-travel.png','old image'],['05-travel.svg','edited SVG'],['notes.md','keep']])await writeFile(join(dir,file),text);
    await writeFile(join(root,'outside.txt'),'outside');
    const identity={schema:'journey-atlas.year-review-export.v1',year:2026,theme:'life',style:'night',format:'story'};
    const previous={...identity,files:[{png:'2026/life-night-story/01-cover.png'},{png:'2026/life-night-story/05-travel.png',svg:'2026/life-night-story/05-travel.svg'},{png:'outside.txt'}]};
    const current={...identity,files:[{png:'2026/life-night-story/01-cover.png'}]};
    const archive=await retirePreviousReviewFiles(root,dir,previous,current);
    assert.deepEqual((await readdir(dir)).sort(),['01-cover.png','notes.md']);
    assert.equal(await readFile(join(archive,'05-travel.svg'),'utf8'),'edited SVG');
    assert.equal(await readFile(join(root,'outside.txt'),'utf8'),'outside');
    assert.equal(await readFile(join(dir,'01-cover.png'),'utf8'),'new');
    assert.equal(await retirePreviousReviewFiles(root,dir,{...previous,year:2025},current),null);
  }finally{await rm(root,{recursive:true,force:true});}
});
