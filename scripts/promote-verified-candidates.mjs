import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCsv, csv } from './atlas-data.mjs';
import { readJson } from './data.mjs';
import { TABLES } from './schema.mjs';
import {parseArgs} from 'node:util';
import {promotionDecision} from './visit-evidence.mjs';
import { readAtlasConfig, resolveSource, sourcePath } from './source-data.mjs';
export {promotionDecision} from './visit-evidence.mjs';

const root = process.cwd();
const {values}=parseArgs({options:{write:{type:'boolean',default:false}}});
const cfg = await readAtlasConfig();
const selectedSource=await resolveSource({config:cfg});
const regionPath = sourcePath(selectedSource,TABLES.regionPlaces);
const candidatePath = sourcePath(selectedSource,TABLES.visitCandidates);
const [regionText, candidateText] = await Promise.all([readFile(regionPath, 'utf8'), readFile(candidatePath, 'utf8')]);
const regions = parseCsv(regionText), candidates = parseCsv(candidateText);
const regionNames = new Set(regions.map(r => `${r['国家地区']}|${r['城市/地点']}`));
const level = name => /山|峰|湖|湾|公园|Mont|Grand Canyon|Big Sur|Yosemite|Death Valley|Pebble/.test(name) ? '景区' : '城市/城镇';
const normalize = s => String(s || '').trim().toLowerCase().replace(/[\s·•()（）]/g, '');
const existingAliases = new Set(regions.flatMap(r => [r['城市/地点'], ...(r['原地名'] || '').split('；')].filter(Boolean).map(n => `${r['国家地区']}|${normalize(n)}`)));
const skipped = [];
const targets = candidates.filter(c => {
  const decision = promotionDecision(c);
  if (!decision.ok) {
    skipped.push({ id: c['地点编号'], country: c['国家地区'], name: c['到访城市/地点'], reason: decision.reason });
    return false;
  }
  const aliases = [c['到访城市/地点'], ...(c['原地名/机场'] || '').split('；')].filter(Boolean);
  // 日本有独立地点表；这里仅晋级共享地区地点，避免把日本候选误写入地区表。
  return c['国家地区'] !== '日本' && !aliases.some(n => existingAliases.has(`${c['国家地区']}|${normalize(n)}`));
});

const cachePath = join(root, 'data/geocode-cache.json');
let cache = {};
try { cache = JSON.parse(await readFile(cachePath, 'utf8')); } catch {}
const geocode = async (name, country) => {
  const key = `${name}|${country}`;
  if (cache[key]) return cache[key];
  // 维护脚本不把在线地理编码当作事实源；没有代表点就进入未解析队列。
  // 已缓存的历史结果仍可复用，但本轮优先使用维护代表点。
  return null;
};

const added = [], unresolved = [],patchRows=[];
for (const c of targets) {
  const name = c['到访城市/地点'], g = await geocode(name, c['国家地区']);
  if (!g || !Number.isFinite(g.lat) || !Number.isFinite(g.lon)) { unresolved.push({ name, country: c['国家地区'] }); continue; }
  const date = c['最早证据日'] || c['最晚证据日'] || '';
  const source = c['关联正文'] || '';
  const row = {
    '地点编号': c['地点编号'], '国家地区': c['国家地区'], '国家代码': c['国家代码'] || '', '一级区域代码': c['一级区域代码'] || '',
    '城市/地点': name, '到访状态': '已到访', '核定依据': `${c['核定依据']||c['证据']}；已在候选表明确核定地面到访`,
    '最早线索日': date, '最晚线索日': c['最晚证据日'] || date, '代表纬度': String(g.lat), '代表经度': String(g.lon), '原地名': c['原地名/机场'] || name,
    '关联正文': source, '照片来源关联编号': c['照片来源关联编号'] || '', '分享纳入': '纳入',
    '备注': `从候选表晋级；地图坐标为${g.display}的代表点，实际到访证据来自照片/正文/客票；后续补交通凭证时替换待核接入边。`,
    '节点级别': level(name), '上级节点编号': '', '交通接入确认': '', '交通接入起始日期': '', '交通接入结束日期': ''
  };
  for(const field of ['核定结论','核定方式','证据引用','核定记录'])row[field]=c[field]||'';
  patchRows.push(row); added.push({ id: row['地点编号'], country: row['国家地区'], name, lat: g.lat, lon: g.lon });
  existingAliases.add(`${c['国家地区']}|${normalize(name)}`);
}
const patchPath=join(root,'inputs','promote-reviewed-candidates.json');
if(values.write&&patchRows.length){await mkdir(join(root,'inputs'),{recursive:true});await writeFile(patchPath,JSON.stringify({version:1,places:patchRows},null,2)+'\n');}
console.log(JSON.stringify({dryRun:!values.write,sourceWritten:false,patch:values.write&&patchRows.length?patchPath:null,note:'只生成已核地面地点的候选补丁；先补齐同次行程进入和离开边，再经统一 update 校验、备份与合并，不直接写正式地点表。',targets: targets.length, skippedCount: skipped.length, skipped: skipped.slice(0, 24), addedCount: added.length, unresolved, examples: added.slice(0, 12) }, null, 2));
