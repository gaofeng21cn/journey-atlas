import {readAtlasConfig} from './source-data.mjs';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { ROOT, readJson ,WORKSPACE_ROOT} from './data.mjs';

// Generic offline browser acceptance. It deliberately discovers the scopes and
// places in the current user's data instead of naming a person's cities.
const { values } = parseArgs({ options: { output: { type: 'string' }, checks: { type: 'string' } } });
const config = await readAtlasConfig();
const configuredOutput = config.output ? (new URL(config.output, pathToFileURL(ROOT + '/')).pathname) : join(WORKSPACE_ROOT, 'outputs');
const output = resolve(values.output || join(configuredOutput, 'site'));
const checksDir = resolve(values.checks || join(WORKSPACE_ROOT, 'private/runtime/browser-checks'));
await stat(join(output, 'index.html')).catch(error => { if (error.code === 'ENOENT') throw new Error('网站尚未构建；先运行 npm run site:build'); throw error; });
await mkdir(checksDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));
const errors = [], requests = [], timings = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(7000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  const start = performance.now();
  await page.goto(pathToFileURL(join(output, 'index.html')).href);
  await page.waitForFunction(() => window.travelAtlas && document.body.dataset.scope);
  const startupMs = Math.round(performance.now() - start);
  const discovered = await page.evaluate(() => ({
    scopes: window.travelAtlas.scopes.map(s => ({ id: s.id, level: s.level, places: window.travelAtlas.query(s.id).places.length })),
    visible: ['world',...new Set([...document.querySelectorAll('[data-tree-scope]')].map(n=>n.dataset.treeScope))],
    current: document.body.dataset.scope,
  }));
  if (discovered.current !== 'world') throw new Error('默认分区必须是全球');
  if (!discovered.scopes.some(s => s.id === 'world')) throw new Error('缺少全球分区');
  const ids = [...new Set(discovered.visible)];
  for (const id of ids.slice(0, 80)) {
    const started = performance.now();
    await page.evaluate(scope => window.travelAtlas.activate(scope, false), id);
    await page.waitForFunction(scope => document.body.dataset.scope === scope, id);
    const audit = await page.evaluate(() => {
      const svg = document.querySelector('#map-stage svg');
      const labels = [...document.querySelectorAll('#map-stage [data-place-label]')];
      const gateways = [...document.querySelectorAll('#map-stage [data-gateway-kind="unknown"]')];
      const overflow = document.documentElement.scrollWidth > window.innerWidth;
      const boxes = labels.map(node => node.getBBox());
      const overlap = boxes.some((a, i) => boxes.slice(i + 1).some(b => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y));
      return { svg: Boolean(svg), labels: labels.length, gateways: gateways.length, overflow, overlap };
    });
    if (!audit.svg) throw new Error(`分区 ${id} 缺少地图画布`);
    if (audit.gateways) throw new Error(`分区 ${id} 存在未识别边缘节点`);
    if (audit.overflow) throw new Error(`分区 ${id} 发生横向溢出`);
    if (audit.overlap) throw new Error(`分区 ${id} 标注重叠`);
    timings.push({ id, ms: Math.round(performance.now() - started), ...audit });
  }
  const externalRequests = requests.filter(url => /^https?:/i.test(url));
  if (externalRequests.length) throw new Error(`离线地图发生外部请求：${externalRequests.join('、')}`);
  if (errors.length) throw new Error(`浏览器错误：${errors.join('；')}`);
  await page.screenshot({ path: join(checksDir, '旅行地图-浏览器检查.png'), fullPage: true });
  const report = { startupMs, scopes: discovered.scopes.length, timings, externalRequests: externalRequests.length, errors };
  await writeFile(join(checksDir, 'browser-check.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} finally { await browser.close(); }
