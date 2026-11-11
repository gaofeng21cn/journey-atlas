import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import {passportAsset,prepareAsset} from './output-paths.mjs';
import { ROOT, readJson ,WORKSPACE_ROOT} from './data.mjs';
import { validateFlightCardData } from './flight-card-data.mjs';

const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const jsonScript = value => JSON.stringify(value).replace(/</g, '\\u003c');

export function loadRenderData({data}={}){
  if(!data)throw new Error('飞行卡必须读取当前atlas投影，不再读取旧travel.json快照');
  return validateFlightCardData(data);
}

export async function render({ data, output = join(WORKSPACE_ROOT, 'outputs'), variant = 'all' } = {}) {
  if (!['all', 'personal', 'social'].includes(variant)) throw new Error('--variant 应为 all、personal 或 social');
  const renderData = loadRenderData({data});
  const profilePath = join(WORKSPACE_ROOT, 'data/profile.json');
  const profile = existsSync(profilePath) ? await readJson(profilePath) : { name: '', latinName: '' };
  const [template, css, map, script] = await Promise.all(['poster.html', 'poster.css', 'world-dots.js', 'poster.js'].map(name => readFile(join(ROOT, 'src', name), 'utf8')));
  // Share only the fields needed to draw the poster, not ticket-level records.
  const viewData = {
    meta: Object.fromEntries(['flightCount', 'plannedCount', 'totalKm', 'totalMinutes', 'firstYear', 'lastYear', 'airlines', 'airports', 'countries', 'cities', 'earthKm'].map(k => [k, renderData.meta[k]])),
    countries: renderData.countries.map(({ name, flag }) => ({ name, flag })),
    airportPoints: renderData.airportPoints, arcs: renderData.arcs,
  };
  const dots = JSON.parse(map.split('=', 2)[1].trim().replace(/;$/, ''));
  const represented = new Set(dots.map(d => d[2]));
  const missingCountries = renderData.countries.filter(c => !represented.has(c.name));
  if (missingCountries.length) throw new Error(`地图缺少国家点位：${missingCountries.map(c => c.name).join('、')}；请在 src/world-dots.js 补一个对应点`);
  const htmlDir=join(output,'html'), checksDir=join(output,'checks');
  await Promise.all([mkdir(output, { recursive: true }),mkdir(htmlDir,{recursive:true}),mkdir(checksDir,{recursive:true})]);
  const channel = process.env.PASSPORT_BROWSER_CHANNEL || (existsSync('/Applications/Google Chrome.app') ? 'chrome' : undefined);
  const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
  const checks = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1120, height: 1494 }, deviceScaleFactor: 2 });
    for (const version of variant === 'all' ? ['personal', 'social'] : [variant]) {
      const social = version === 'social';
      const name = social ? '' : profile.name || '';
      const latin = social ? '' : profile.latinName || '';
      const replacements = {
        PAGE_TITLE: name ? `${escape(name)}的旅行护照` : '我的旅行护照',
        TOPLINE: latin ? `${escape(latin)} · WORLD JOURNEYS` : 'WORLD JOURNEYS',
        OWNER: name ? `<span>${escape(name)}<small>${escape(latin)}</small></span>` : '',
        MACHINE_NAME: latin ? `${escape(latin.toUpperCase().replace(/[^A-Z0-9]/g, ''))}&lt;&lt;` : '',
      };
      let html = template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => replacements[key]);
      html = html.replace('<link rel="stylesheet" href="./poster.css" />', `<style>${css}</style>`)
        .replace(/    <script src="\.\/world-dots.js"><\/script><script src="\.\/data.js"><\/script><script src="\.\/poster.js"><\/script>/,
          `<script>${map}</script><script>window.FLIGHT_DATA = ${jsonScript(viewData)};</script><script>${script}</script>`);
      if (/\{\{[A-Z_]+\}\}|src="\.\//.test(html)) throw new Error('模板替换不完整');
      if (social && [profile.name, profile.latinName].filter(Boolean).some(n => html.toLowerCase().includes(n.toLowerCase()))) throw new Error('无姓名版仍包含姓名');
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const check = await page.evaluate(() => ({
        overflow: document.querySelector('.paper').scrollHeight > document.querySelector('.paper').clientHeight + 1,
        emptyStats: [...document.querySelectorAll('[data-stat]')].filter(n => !n.textContent.trim()).map(n => n.dataset.stat),
        countryLabels: document.querySelectorAll('.stamp').length,
        time: document.querySelector('.time-number').innerText.replace(/\s+/g, ' '),
        distance: document.querySelector('[data-stat="distance"]').textContent,
        bodyText: document.body.innerText,
      }));
      if (errors.length || check.overflow || check.emptyStats.length || check.countryLabels !== renderData.meta.countries) throw new Error(`成图检查失败：${JSON.stringify({ errors, ...check, bodyText: undefined })}`);
      if (/约|计划|已飞|推算|数据来源/.test(check.bodyText)) throw new Error('图片出现已要求移除的说明');
      const stem = social ? '全球飞行护照-分享' : '全球飞行护照-个人';
      const asset={kind:'flight',name:'全球',variant:social?'分享':'个人'};
      await writeFile(await prepareAsset(passportAsset(output,{...asset,format:'html'})), html);
      await page.locator('#poster').screenshot({ path: await prepareAsset(passportAsset(output,asset)) });
      delete check.bodyText;
      checks.push({ version, png: passportAsset('',asset), ...check, nameHidden: social });
      await page.close();
      console.log(`已导出 ${passportAsset(output,asset)}`);
    }
  } finally {
    await browser.close();
  }
  await writeFile(join(checksDir, 'render-checks.json'), JSON.stringify(checks, null, 2) + '\n');
  return checks;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { data: { type: 'string' }, output: { type: 'string' }, variant: { type: 'string', default: 'all' } } });
  if(!values.data)throw new Error('请用 --data 指定当前 atlas 飞行投影；旧 travel.json 入口已停用');
  render({ data:await readJson(resolve(values.data)), output: values.output && resolve(values.output), variant: values.variant }).catch(err => { console.error(err.message); process.exitCode = 1; });
}
