import {readAtlasConfig} from './source-data.mjs';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { ROOT, readJson ,WORKSPACE_ROOT} from './data.mjs';

// Generic offline browser acceptance. It deliberately discovers the scopes and
// places in the current user's data instead of naming a person's cities.
const { values } = parseArgs({ options: { output: { type: 'string' }, checks: { type: 'string' } } });
const config = await readAtlasConfig();
const configuredOutput = config.output || join(WORKSPACE_ROOT, 'outputs');
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
  const firstScope = await page.evaluate(() => [...document.querySelectorAll('.tree-select')].find(e => e.dataset.scope !== 'world')?.dataset.scope);
  if (await page.locator('[role="tree"], [role="treeitem"]').count()) throw new Error('地区导航语义与原生链接行为不符');
  if (firstScope) {
    await page.evaluate(id => window.travelAtlas.activate(id), firstScope);
    await page.goBack(); await page.waitForFunction(() => document.body.dataset.scope === 'world');
    await page.goForward(); await page.waitForFunction(id => document.body.dataset.scope === id, firstScope);
    await page.goBack(); await page.waitForFunction(() => document.body.dataset.scope === 'world');
  }
  await page.locator('[data-map-zoom="in"]').click();
  const zoomed = await page.locator('#map-stage svg').getAttribute('viewBox');
  await page.locator('#map-stage').focus(); await page.keyboard.press('ArrowLeft');
  if (zoomed === await page.locator('#map-stage svg').getAttribute('viewBox')) throw new Error('地图键盘平移无效');
  const cancelled = await page.evaluate(() => {
    const svg = document.querySelector('#map-stage svg'), box = svg.getBoundingClientRect();
    const send = (type, delta) => svg.dispatchEvent(new PointerEvent(type, {pointerId: 7, isPrimary: true, pointerType: 'touch', button: 0, buttons: 1, bubbles: true, clientX: box.x + box.width / 2 + delta, clientY: box.y + box.height / 2}));
    send('pointerdown', 0); send('pointermove', 15); send('pointercancel', 15); const atCancel = svg.getAttribute('viewBox'); send('pointermove', 40);
    return atCancel === svg.getAttribute('viewBox');
  });
  if (!cancelled) throw new Error('取消拖动后地图仍在移动');
  await page.locator('[data-map-zoom="reset"]').click();
  const discovered = await page.evaluate(() => ({
    scopes: window.travelAtlas.scopes.map(s => ({ id: s.id, level: s.level, places: window.travelAtlas.query(s.id).places.length })),
    visible: ['world',...new Set([...document.querySelectorAll('[data-tree-scope]')].map(n=>n.dataset.treeScope))],
    current: document.body.dataset.scope,
  }));
  if (discovered.current !== 'world') throw new Error('默认分区必须是全球');
  if (!discovered.scopes.some(s => s.id === 'world')) throw new Error('缺少全球分区');
  const ids = [...new Set(discovered.visible)];
  const passportCity = ids.find(id => id.startsWith('city:'));
  if (passportCity) {
    const valid = await page.evaluate(id => {
      const before=document.body.dataset.scope,svg=window.travelAtlas.passport(id);
      return before===document.body.dataset.scope&&svg.includes('<svg')&&svg.includes('city-district');
    },passportCity);
    if (!valid) throw new Error('未切换页面时无法导出城市地图');
  }
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
  const city = ids.find(id => id.startsWith('city:'));
  if (city) {
    await page.evaluate(id => window.travelAtlas.activate(id, false), city);
    const beforeGateways = await page.locator('#map-stage svg').getAttribute('data-gateways-visible');
    if (await page.locator('#toggle-gateways').isVisible()) {
      await page.locator('#toggle-gateways').click();
      if (Number(await page.locator('#map-stage svg').getAttribute('data-gateways-visible')) <= Number(beforeGateways)) throw new Error('展开进出城市后地图未更新');
      await page.locator('#toggle-gateways').click();
      if (await page.locator('#map-stage svg').getAttribute('data-gateways-visible') !== beforeGateways) throw new Error('收起进出城市后地图未恢复');
    }
    const day = await page.locator('#day-select option').evaluateAll(options => options.find(option => option.value)?.value);
    if (day) {
      await page.locator('#day-select').selectOption(day);
      const expected = await page.evaluate(({id, date}) => window.travelAtlas.query(id,{date}).tracks.length,{id:city,date:day});
      if (Number(await page.locator('#map-stage svg').getAttribute('data-track-count')) !== expected) throw new Error('日期筛选后的地图轨迹不一致');
      await page.locator('#day-select').selectOption('');
      if (await page.locator('#map-stage svg').getAttribute('data-gateways-visible') !== beforeGateways) throw new Error('清除日期筛选后地图未恢复');
    }
  }
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const phone = await mobile.newPage(); phone.on('pageerror', error => errors.push(error.message));
    await phone.addInitScript(() => {
      const original = JSON.parse;
      JSON.parse = function (...args) {
        const value = original.apply(this,args);
        const world = value?.scopes?.find(scope => scope.id === 'world');
        if (world) world.unitLabel = '<img src=x onerror="window.__atlasInjected=1">';
        return value;
      };
    });
    await phone.goto(pathToFileURL(join(output, 'index.html')).href); await phone.waitForFunction(() => window.travelAtlas && document.body.dataset.scope);
    const safeLabel = await phone.evaluate(() => ({text:document.querySelector('#coverage-text span').textContent, images:document.querySelectorAll('#stats img, #coverage-text img').length, ran:window.__atlasInjected}));
    if (!safeLabel.text.includes('<img') || safeLabel.images || safeLabel.ran) throw new Error('区域标签没有按文本显示');
    await phone.locator('#mobile-nav-toggle').click();
    if (!await phone.locator('#scope-search').isVisible()) throw new Error('移动导航未显示搜索');
    const target = await phone.locator('.tree-select').nth(1).textContent();
    await phone.locator('#scope-search').fill(target); await phone.locator('#search-results button').first().click();
    if (await phone.locator('#mobile-nav-toggle').getAttribute('aria-expanded') !== 'false' || await phone.evaluate(() => document.activeElement.id) !== 'mobile-nav-toggle') throw new Error('移动导航收起后焦点未返回');
    await phone.locator('[data-map-zoom="in"]').click();
    const targets = await phone.locator('[data-map-zoom], [data-map-pan]').evaluateAll(buttons => buttons.map(button => {const box=button.getBoundingClientRect();return {width:box.width,height:box.height};}));
    if (targets.some(box => box.width < 44 || box.height < 44)) throw new Error('地图触控目标小于 44 像素');
    if (await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('移动页面横向溢出');
  } finally { await mobile.close(); }
  const poster = await browser.newPage();
  try {
    await poster.setContent('<svg><g id="mapDots"></g><g id="mapArcs"></g><g id="mapNodes"></g></svg><ul id="stamps"></ul><div id="machineStats"></div>');
    await poster.evaluate(() => {window.WORLD_DOTS=[];window.FLIGHT_DATA={countries:[{name:'<img src=x onerror="window.__atlasInjected=1">',flag:'<&>'}],arcs:[],airportPoints:[],meta:{flightCount:0,plannedCount:0,totalMinutes:0,totalKm:0,earthKm:40075,firstYear:2020,lastYear:2020,countries:1,cities:0,airports:0,airlines:0}};});
    await poster.addScriptTag({content:await readFile(join(ROOT,'src/poster.js'),'utf8')});
    const stamp = await poster.evaluate(() => ({text:document.querySelector('#stamps').textContent,images:document.querySelectorAll('#stamps img').length,ran:window.__atlasInjected}));
    if (!stamp.text.includes('<img') || !stamp.text.includes('<&>') || stamp.images || stamp.ran) throw new Error('飞行护照国家名称没有按文本显示');
  } finally { await poster.close(); }
  const externalRequests = requests.filter(url => /^https?:/i.test(url));
  if (externalRequests.length) throw new Error(`离线地图发生外部请求：${externalRequests.join('、')}`);
  if (errors.length) throw new Error(`浏览器错误：${errors.join('；')}`);
  await page.screenshot({ path: join(checksDir, '旅行地图-浏览器检查.png'), fullPage: true });
  const report = { startupMs, scopes: discovered.scopes.length, timings, externalRequests: externalRequests.length, errors };
  await writeFile(join(checksDir, 'browser-check.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} finally { await browser.close(); }
