import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildOverview, buildAnnual, buildRegions } from '../app-contribution.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'travel-passport-contribution-'));
  const output = join(root, 'outputs');
  await mkdir(join(output, '01_全球护照'), { recursive: true });
  await mkdir(join(output, '02_地区护照'), { recursive: true });
  await mkdir(join(output, 'html/01_全球护照'), { recursive: true });
  await mkdir(join(output, 'html/02_地区护照'), { recursive: true });
  await mkdir(join(output, 'data'), { recursive: true });
  await mkdir(join(root, 'data'), { recursive: true });
  await writeFile(join(root, 'data/atlas-config.json'), JSON.stringify({ output: 'outputs' }));
  for (const file of [
    '01_全球护照/旅行护照-全球-分享.png', 'html/01_全球护照/旅行护照-全球-分享.html',
    '01_全球护照/年度旅行卡-2026-分享.png', 'html/01_全球护照/年度旅行卡-2026-分享.html',
    '02_地区护照/旅行护照-日本-分享.png', 'html/02_地区护照/旅行护照-日本-分享.html',
  ]) await writeFile(join(output, file), 'fixture');
  await writeFile(join(output, 'data/年度旅行摘要-2026.json'), JSON.stringify({
    metrics: { totalKm: 2400, flightHours: 12, countries: 2, cities: 3 },
    dataThrough: '2026-06-30', newCountries: ['示例国家'], farthest: { name: '示例远方城市' },
  }));
  return { root, dispose: () => rm(root, { recursive: true, force: true }) };
}

const status = { build: { state: 'fresh', lastGeneratedAt: '2026-11-09T00:00:00Z' }, quality: { state: 'ready' }, sharing: { totalKm: 12345, flightHours: 123, countries: 3, nodes: 42, routes: 64, firstYear: 2020, lastYear: 2026 }, regions: { japan: { visited: 2, total: 47, cities: 3, km: 1234, routes: 4 } } };

test('总览投影只返回摘要和已有产物引用', async () => {
  const f = await fixture();
  try {
    const result = buildOverview(f.root, status);
    assert.equal(result.data.items[0].km, 12345);
    assert.equal(result.data.items[0].artifacts.length, 2);
    assert.ok(result.data.items[0].artifacts.every(a => a.artifact_ref.startsWith(f.root)));
  } finally { await f.dispose(); }
});

test('年度投影按年度摘要和成品生成 artifact_view 项', async () => {
  const f = await fixture();
  try {
    const result = buildAnnual(f.root, status, 2026);
    assert.equal(result.data.items[0].km, 2400);
    assert.equal(result.data.items[0].data_through, '2026-06-30');
    assert.equal(result.data.items[0].artifacts.length, 2);
  } finally { await f.dispose(); }
});

test('地区投影按移动里程排序，并保留覆盖率字段', async () => {
  const f = await fixture();
  try {
    const result = buildRegions(f.root, { regions: { usa: { km: 40000, visited: 15, denominator: 50, cities: 3, routes: 10 }, japan: { km: 1234, visited: 2, total: 47, cities: 3, routes: 4 } } });
    assert.deepEqual(result.data.items.map(item => item.region_id), ['usa', 'japan']);
    assert.equal(result.data.items[1].denominator, 47);
    assert.equal(result.data.items[1].artifacts.length, 2);
  } finally { await f.dispose(); }
});

test('地区投影隐藏没有到访、地点、路线或里程的空区域', async () => {
  const f = await fixture();
  try {
    const result = buildRegions(f.root, {
      regions: {
        china: { km: 120, visited: 1, cities: 1, routes: 2 },
        empty: { km: 0, visited: 0, cities: 0, routes: 0, denominator: 10 },
      },
    });
    assert.deepEqual(result.data.items.map(item => item.region_id), ['china']);
  } finally { await f.dispose(); }
});
