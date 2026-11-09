import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pruneHistory} from '../scripts/prune-history.mjs';

// Backup folders are recovery aids, not maintained sources. The retention pass
// must only ever touch folders that match the automatic writer pattern, and
// must keep the newest ones so a rollback right after an update still works.
async function fixture(names) {
  const dir = await mkdtemp(join(tmpdir(), 'history-'));
  for (const name of names) {
    await mkdir(join(dir, name), {recursive: true});
    await writeFile(join(dir, name, 'receipt.json'), '{}');
  }
  return dir;
}

test('历史备份轮转只删自动备份目录并保留最新若干份', async () => {
  const dir = await fixture([
    '2026-10-09T10-00-59-993Z-atlas',
    '2026-10-10T02-40-30-423Z-atlas',
    '2026-10-15T05-31-24-985Z-atlas',
    '2026-10-15T11-49-13-443Z-cities',
    '手动保留的名字',
  ]);
  try {
    const report = await pruneHistory({keep: 2, dir});
    assert.equal(report.total, 4, '手动目录不计入自动备份总数');
    assert.deepEqual(report.removed.sort(), ['2026-10-09T10-00-59-993Z-atlas', '2026-10-10T02-40-30-423Z-atlas']);
    const left = (await readdir(dir)).sort();
    assert.deepEqual(left, ['2026-10-15T05-31-24-985Z-atlas', '2026-10-15T11-49-13-443Z-cities', '手动保留的名字']);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('历史备份轮转 dry-run 不改动磁盘', async () => {
  const dir = await fixture(['2026-10-09T10-00-59-993Z-atlas', '2026-10-15T05-31-24-985Z-atlas']);
  try {
    const report = await pruneHistory({keep: 1, apply: false, dir});
    assert.equal(report.removed.length, 1);
    assert.equal((await readdir(dir)).length, 2);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('无效保留数量不能变成全部删除，缺少回滚目录可安全预览',async()=>{
  const dir=await fixture(['2026-10-15T05-31-24-985Z-atlas']);
  try{
    for(const keep of [NaN,Infinity,-1,0,1.5])await assert.rejects(pruneHistory({keep,dir}),/正整数/);
    assert.equal((await readdir(dir)).length,1);
    assert.equal((await pruneHistory({dir:join(dir,'not-created'),apply:false})).total,0);
  }finally{await rm(dir,{recursive:true,force:true});}
});
