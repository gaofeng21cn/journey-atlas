#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { dependenciesReady, setupRuntime } from './journey-atlas.mjs';
import { reviewThemes, reviewStyles } from './src/year-review.mjs';

const REQUEST_SCHEMA = 'opl-package-app-contribution-request.v1';
const RESPONSE_SCHEMA = 'opl-package-app-contribution-response.v1';
const REFS = new Set([
  'travel.passport.v1#status',
  'travel.passport.v1#overview',
  'travel.passport.v1#annual',
  'travel.passport.v1#regions',
]);
const SETUP_REF = 'travel.passport.v1#runtime.setup';
const GENERATE_REF = 'travel.passport.v1#annual.generate';
const ANNUAL_INPUT_SCHEMA = {
  type: 'object',
  required: ['year'],
  properties: {
    year: { type: 'integer', title: '年份', minimum: 1900, maximum: 2200 },
    theme: { type: 'string', title: '主题', enum: ['life', 'travel', 'creation'], default: 'life' },
    style: { type: 'string', title: '风格', enum: ['paper', 'night', 'blueprint'], default: 'paper' },
    format: { type: 'string', title: '形式', enum: ['single', 'story'], default: 'single' },
    include_planned: { type: 'boolean', title: '计入本年度待飞行程' },
  },
};
const packageRoot = path.dirname(fileURLToPath(import.meta.url));

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', () => {
      try { resolve(JSON.parse(input)); } catch (error) { reject(error); }
    });
    process.stdin.on('error', reject);
  });
}

function runStatus(workspaceRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(packageRoot, 'journey-atlas.mjs'), '--workspace', workspaceRoot, 'status', '--json'], {
      cwd: packageRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Journey Atlas status failed (${code}): ${stderr.slice(0, 1000)}`));
        return;
      }
      try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
    });
  });
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

function outputRoot(ownerRoot) {
  const config = readJson(path.join(ownerRoot, 'data', 'atlas-config.json')) || {};
  return path.resolve(ownerRoot, config.output || path.join(ownerRoot, 'outputs'));
}

function artifact(ownerRoot, relativePath, title, mediaType = 'image/png') {
  const ref = path.join(outputRoot(ownerRoot), relativePath);
  if (!existsSync(ref)) return null;
  return { title, artifact_ref: ref, artifact_kind: mediaType, media_type: mediaType,
    status: 'available', source_refs: [`travel-passport://output/${relativePath}`] };
}

function statusItem(status) {
  const sharing = status.sharing || {};
  return {
    id: 'travel-passport-status', title: '旅行护照状态',
    summary: `构建：${String(status.build?.state ?? 'unknown')}；质量：${String(status.quality?.state ?? 'unknown')}`,
    status: status.quality?.state === 'ready' ? 'ready' : 'attention', source_refs: ['travel-passport://status'],
    km: Math.round(Number(sharing.totalKm || 0)), flight_hours: Math.round(Number(sharing.flightHours || 0)),
    countries: Number(sharing.countries || 0), places: Number(sharing.nodes || 0), routes: Number(sharing.routes || 0),
  };
}

export function buildOverview(ownerRoot, status) {
  const item = statusItem(status);
  item.id = 'travel-passport-overview';
  item.title = '全球旅行护照';
  item.summary = `累计 ${item.km.toLocaleString('en-US')} 公里 · ${item.countries} 个国家与地区 · ${item.places} 个地点`;
  item.period = `${status.sharing?.firstYear || '—'} — ${status.sharing?.lastYear || '—'}`;
  item.artifacts = [
    artifact(ownerRoot, '01_全球护照/旅行护照-全球-分享.png', '全球旅行护照 PNG'),
    artifact(ownerRoot, 'html/01_全球护照/旅行护照-全球-分享.html', '全球旅行护照 HTML', 'text/html'),
    artifact(ownerRoot, 'site/index.html', '交互旅行地图 HTML', 'text/html'),
  ].filter(Boolean);
  return { state: 'ready', data: { items: [item], generated_at: status.build?.lastGeneratedAt || null, quality: status.quality?.state || 'unknown' } };
}

export function availableYears(output) {
  try {
    return readdirSync(path.join(output, 'data'))
      .map(name => /^年度旅行摘要-(\d{4})\.json$/.exec(name)?.[1]).filter(Boolean).map(Number).sort((a, b) => b - a);
  } catch { return []; }
}

export function buildAnnual(ownerRoot, status, requestedYear) {
  const output = outputRoot(ownerRoot), index=readJson(path.join(output,'annual-reviews/index.json'));
  const configured=Object.keys(readJson(path.join(ownerRoot,'data/annual-config.json'))?.years||{}).map(Number);
  const years=[...new Set([...availableYears(output),...configured,...(index?.editions||[]).map(e=>e.year)])].filter(Number.isInteger).sort((a,b)=>b-a);
  const year = Number.isInteger(requestedYear) ? requestedYear : years[0] || new Date().getFullYear();
  const summary = readJson(path.join(output, 'data', `年度旅行摘要-${year}.json`));
  const editions=(index?.editions||[]).filter(e=>e.year===year).map(e=>({
    ...e, content:readJson(path.join(output,'annual-reviews',e.manifest)),
  })).filter(e=>e.content);
  const latest=editions.at(-1)?.content;
  const metrics = latest?.travelMetrics || summary?.metrics || {};
  const available=Boolean(latest||summary);
  const item = {
    id: `travel-passport-annual-${year}`, title: `${year} 年度总结`,
    summary: latest ? `${metrics.flightCount || 0} 飞行航段 · ${Math.round(Number(metrics.flightKm || 0)).toLocaleString('en-US')} 飞行公里` : summary ? `${Number(metrics.totalKm || 0).toLocaleString('en-US')} 公里 · ${metrics.countries || 0} 个国家与地区 · ${metrics.cities || 0} 个城市` : '选择主题和风格，制作这一年的卡片',
    status: available ? 'available' : 'unavailable', year, data_through: latest?.model.dataThrough || summary?.dataThrough || null,
    includes_planned:latest?.includesPlanned??false,
    km: Number(metrics.totalKm || 0), flight_hours: Number(metrics.flightHours || 0),
    countries: Number(metrics.countries || 0), cities: Number(metrics.cities || 0),
    new_countries: summary?.newCountries || [], farthest: summary?.farthest?.name || null,
    artifacts: [
      artifact(ownerRoot, `01_全球护照/年度旅行卡-${year}-分享.png`, `${year} 年度旅行卡 PNG`),
      artifact(ownerRoot, `html/01_全球护照/年度旅行卡-${year}-分享.html`, `${year} 年度旅行卡 HTML`, 'text/html'),
    ].filter(Boolean), source_refs: [`travel-passport://annual/${year}`],
  };
  const gallery=artifact(ownerRoot,'annual-reviews/index.html','年度总结 · 选择主题、风格与单卡／多卡','text/html');
  if(gallery)item.artifacts.unshift(gallery);
  const editionItems=editions.map(e=>({
    id:`annual-${year}-${e.theme}-${e.style}-${e.format}`,title:`${year} · ${reviewThemes.find(t=>t.id===e.theme)?.name||e.theme} · ${reviewStyles.find(s=>s.id===e.style)?.name||e.style} · ${e.format==='story'?'多卡故事':'单卡总览'}`,
    year,page_count:e.pageCount,status:'available',source_refs:[`travel-passport://annual/${year}`],
    artifacts:(e.content.files||[]).flatMap((file,i)=>[
      artifact(ownerRoot,'annual-reviews/'+file.png,`第 ${i+1} 张 · PNG`),
      artifact(ownerRoot,'annual-reviews/'+file.svg,`第 ${i+1} 张 · 可编辑 SVG`,'image/svg+xml'),
    ]).filter(Boolean),
  }));
  return { state: 'ready', data: { items: [item,...editionItems], available_years: years, quality: status.quality?.state || 'unknown',
    themes:['life','travel','creation'],styles:['paper','night','blueprint'],formats:['single','story'],max_story_pages:9,story_page_count:9,
    action_ref: GENERATE_REF,
    command_inputs: { [GENERATE_REF]: { input_schema: ANNUAL_INPUT_SCHEMA } },
  } };
}

export function runAnnualReview(ownerRoot,input={}){
  if(!Number.isInteger(input.year)||input.year<1900||input.year>2200)throw new Error('请选择1900—2200之间的年度');
  if(Object.keys(input).some(k=>!['year','theme','style','format','include_planned'].includes(k)))throw new Error('年度总结包含未知选项');
  if(input.include_planned!==undefined&&typeof input.include_planned!=='boolean')throw new Error('待飞选项须为布尔值');
  const args=[path.join(packageRoot,'journey-atlas.mjs'),'--workspace',ownerRoot,'review','--year',String(input.year)];
  for(const key of ['theme','style','format'])if(input[key]!==undefined){if(typeof input[key]!=='string')throw new Error('年度总结选项须为文字');args.push('--'+key,input[key]);}
  if(input.include_planned!==undefined)args.push(input.include_planned?'--include-planned':'--exclude-planned');
  return new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:packageRoot,env:process.env,stdio:['ignore','pipe','pipe']});let out='',err='';
    child.stdout.on('data',c=>{out+=c;});child.stderr.on('data',c=>{err+=c;});child.on('error',reject);child.on('close',code=>{if(code!==0)return reject(new Error(err.slice(-1500)||'年度总结生成失败'));try{resolve(JSON.parse(out));}catch(error){reject(error);}});});
}

const regionNames = { china: '中国', usa: '美国', europe: '欧洲', japan: '日本', 'southeast-asia': '东南亚', switzerland: '瑞士', italy: '意大利', greece: '希腊' };

export function buildRegions(ownerRoot, status) {
  const regions = { ...(status.regions || {}) };
  if (status.japan) regions.japan = { ...status.japan, denominator: status.japan.total };
  const items = Object.entries(regions).filter(([, value]) => (
    ['visited', 'cities', 'routes', 'km'].some(key => Number(value?.[key] || 0) > 0)
  )).map(([id, value]) => {
    const name = regionNames[id] || id, km = Math.round(Number(value.km || 0));
    return {
      id: `travel-passport-region-${id}`, title: name,
      summary: `${km.toLocaleString('en-US')} 公里 · ${value.visited || 0} / ${value.denominator || 0} 个区域 · ${value.cities || 0} 个地点`,
      status: 'available', region_id: id, km, visited: Number(value.visited || 0),
      denominator: Number(value.denominator || value.total || 0), cities: Number(value.cities || 0), routes: Number(value.routes || 0),
      first_year: value.firstYear || null, last_year: value.lastYear || null,
      artifacts: [
        artifact(ownerRoot, `02_地区护照/旅行护照-${name}-分享.png`, `${name}旅行护照 PNG`),
        artifact(ownerRoot, `html/02_地区护照/旅行护照-${name}-分享.html`, `${name}旅行护照 HTML`, 'text/html'),
      ].filter(Boolean), source_refs: [`travel-passport://region/${id}`],
    };
  }).sort((a, b) => b.km - a.km || a.title.localeCompare(b.title, 'zh-CN'));
  return { state: 'ready', data: { items, count: items.length, source: 'travel-passport://regions' } };
}

async function main() {
  const request = await readStdin();
  const { schema_version, operation } = request ?? {};
  const nativeAction = operation === 'execute' && request.ref === undefined && request.dry_run === false;
  const ref = nativeAction ? request.action_id : request?.ref;
  const input = (nativeAction ? request.payload : request?.input) ?? {};
  const setup = operation === 'execute' && ref === SETUP_REF;
  const generate = operation === 'execute' && ref === GENERATE_REF;
  if (
    schema_version !== REQUEST_SCHEMA
    || !(setup || generate || operation === 'read' && REFS.has(ref))
  ) {
    throw new Error('unsupported app contribution request');
  }
  if (setup) {
    await setupRuntime();
    process.stdout.write(JSON.stringify({ schema_version: RESPONSE_SCHEMA, ok: true, ref, operation, result: { state: 'ready', data: { status: 'ready', dependencies: 'package-lock.json' } } }));
    return;
  }
  if (!dependenciesReady()) {
    process.stdout.write(JSON.stringify({ schema_version: RESPONSE_SCHEMA, ok: true, ref, operation, result: { state: 'input_required', reason: '首次使用请初始化 Journey Atlas 运行环境；此操作只安装锁定依赖，不改动旅行资料。', data: { action_ref: SETUP_REF } } }));
    return;
  }
  const ownerRoot = process.env.OPL_PROFILE_WORKSPACE || process.env.JOURNEY_ATLAS_WORKSPACE;
  if (!ownerRoot || !existsSync(path.join(ownerRoot, 'data', 'atlas-config.json'))) {
    process.stdout.write(JSON.stringify({
      schema_version: RESPONSE_SCHEMA,
      ok: true,
      ref,
      operation,
      result: {
        state: 'input_required',
        reason: '请选择已配置的 Journey Atlas 工作区；资料仍保存在原目录或 Obsidian 中。',
        input_schema: {
          type: 'object',
          required: ['workspace_path'],
          properties: { workspace_path: { type: 'string', title: 'Journey Atlas 工作区路径' } },
          additionalProperties: false,
        },
      },
    }));
    return;
  }
  const status = await runStatus(ownerRoot);
  if (generate) {
    const exported = await runAnnualReview(ownerRoot, input);
    const data = { ...exported, ...buildAnnual(ownerRoot, status, input.year).data };
    process.stdout.write(JSON.stringify({ schema_version: RESPONSE_SCHEMA, ok: true, ref, operation, result: { state: 'ready', data } }));
    return;
  }
  const result = ref === 'travel.passport.v1#overview' ? buildOverview(ownerRoot, status)
    : ref === 'travel.passport.v1#annual' ? buildAnnual(ownerRoot, status, input.year)
      : ref === 'travel.passport.v1#regions' ? buildRegions(ownerRoot, status)
        : { state: 'ready', data: { items: [statusItem(status)], status } };
  process.stdout.write(JSON.stringify({
    schema_version: RESPONSE_SCHEMA,
    ok: true,
    ref,
    operation,
    result,
  }));
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
