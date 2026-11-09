#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REQUEST_SCHEMA = 'opl-package-app-contribution-request.v1';
const RESPONSE_SCHEMA = 'opl-package-app-contribution-response.v1';
const REFS = new Set([
  'travel.passport.v1#status',
  'travel.passport.v1#overview',
  'travel.passport.v1#annual',
  'travel.passport.v1#regions',
]);
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

function runStatus(ownerRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/passport.mjs', 'status', '--json'], {
      cwd: ownerRoot,
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
        reject(new Error(`Travel Passport status failed (${code}): ${stderr.slice(0, 1000)}`));
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
  const output = outputRoot(ownerRoot), years = availableYears(output);
  const year = Number.isInteger(requestedYear) ? requestedYear : years[0] || new Date().getFullYear();
  const summary = readJson(path.join(output, 'data', `年度旅行摘要-${year}.json`));
  const metrics = summary?.metrics || {};
  const item = {
    id: `travel-passport-annual-${year}`, title: `${year} 年度旅行回顾`,
    summary: summary ? `${Number(metrics.totalKm || 0).toLocaleString('en-US')} 公里 · ${metrics.countries || 0} 个国家与地区 · ${metrics.cities || 0} 个城市` : '尚未生成该年度旅行卡',
    status: summary ? 'available' : 'unavailable', year, data_through: summary?.dataThrough || null,
    km: Number(metrics.totalKm || 0), flight_hours: Number(metrics.flightHours || 0),
    countries: Number(metrics.countries || 0), cities: Number(metrics.cities || 0),
    new_countries: summary?.newCountries || [], farthest: summary?.farthest?.name || null,
    artifacts: [
      artifact(ownerRoot, `01_全球护照/年度旅行卡-${year}-分享.png`, `${year} 年度旅行卡 PNG`),
      artifact(ownerRoot, `html/01_全球护照/年度旅行卡-${year}-分享.html`, `${year} 年度旅行卡 HTML`, 'text/html'),
    ].filter(Boolean), source_refs: [`travel-passport://annual/${year}`],
  };
  return { state: 'ready', data: { items: [item], available_years: years, quality: status.quality?.state || 'unknown' } };
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
  if (
    request?.schema_version !== REQUEST_SCHEMA
    || request?.operation !== 'read'
    || !REFS.has(request?.ref)
  ) {
    throw new Error('unsupported app contribution request');
  }
  const ownerRoot = process.env.OPL_PROFILE_WORKSPACE
    || (existsSync(path.join(packageRoot, 'scripts', 'passport.mjs')) ? packageRoot : null);
  if (!ownerRoot) {
    process.stdout.write(JSON.stringify({
      schema_version: RESPONSE_SCHEMA,
      ok: true,
      ref: request.ref,
      operation: 'read',
      result: {
        state: 'input_required',
        reason: '请选择已登记的旅行护照工作区。',
        input_schema: {
          type: 'object',
          required: ['workspace_path'],
          properties: { workspace_path: { type: 'string', title: '旅行护照工作区路径' } },
          additionalProperties: false,
        },
      },
    }));
    return;
  }
  const manifest = JSON.parse(readFileSync(path.join(ownerRoot, 'package.json'), 'utf8'));
  if (manifest.name !== 'travel-passport') throw new Error('Selected workspace is not Travel Passport.');
  const status = await runStatus(ownerRoot);
  const result = request.ref === 'travel.passport.v1#overview' ? buildOverview(ownerRoot, status)
    : request.ref === 'travel.passport.v1#annual' ? buildAnnual(ownerRoot, status, request.input?.year)
      : request.ref === 'travel.passport.v1#regions' ? buildRegions(ownerRoot, status)
        : { state: 'ready', data: { items: [statusItem(status)], status } };
  process.stdout.write(JSON.stringify({
    schema_version: RESPONSE_SCHEMA,
    ok: true,
    ref: request.ref,
    operation: 'read',
    result,
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
