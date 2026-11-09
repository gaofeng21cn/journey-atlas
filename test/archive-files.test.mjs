import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {ROOT} from '../scripts/data.mjs';

test('归档完整保存中文路径和原字节，逐项回读后才移除展开原件',async()=>{
  const root=await mkdtemp(join(tmpdir(),'travel-archive-'));
  try{
    await mkdir(join(root,'旧工作台'));
    await writeFile(join(root,'旧工作台/证据.json'),'原始证据\n');
    const plan=join(root,'plan.json'),archive=join(root,'history/snapshot.zip');
    await writeFile(plan,JSON.stringify({root,archive,files:['旧工作台/证据.json'],reason:'测试'}));
    const result=JSON.parse(execFileSync('python3',[join(ROOT,'scripts/archive-files.py'),'--plan',plan,'--remove'],{encoding:'utf8'}));
    assert.equal(result.files,1);assert.equal(result.removed,true);
    await assert.rejects(stat(join(root,'旧工作台/证据.json')),e=>e.code==='ENOENT');
    const content=execFileSync('python3',['-c','import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); sys.stdout.buffer.write(z.read("旧工作台/证据.json"))',archive]);
    assert.equal(content.toString(),'原始证据\n');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('归档拒绝越界成员和覆盖已有恢复包，失败时保留源文件',async()=>{
  const root=await mkdtemp(join(tmpdir(),'travel-archive-'));
  try{
    const plan=join(root,'plan.json'),archive=join(root,'snapshot.zip');
    await writeFile(join(root,'source.txt'),'current');
    await writeFile(plan,JSON.stringify({root,archive,files:['../outside.txt']}));
    assert.throws(()=>execFileSync('python3',[join(ROOT,'scripts/archive-files.py'),'--plan',plan,'--remove'],{stdio:'pipe'}));
    await writeFile(archive,'older archive');
    await writeFile(plan,JSON.stringify({root,archive,files:['source.txt']}));
    assert.throws(()=>execFileSync('python3',[join(ROOT,'scripts/archive-files.py'),'--plan',plan,'--remove'],{stdio:'pipe'}));
    assert.equal(await readFile(archive,'utf8'),'older archive');assert.equal(await readFile(join(root,'source.txt'),'utf8'),'current');
  }finally{await rm(root,{recursive:true,force:true});}
});
