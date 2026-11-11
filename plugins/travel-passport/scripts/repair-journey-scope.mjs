import {readAtlasConfig,resolveSource,sourcePath} from './source-data.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { ROOT,readJson } from './data.mjs';
import { TABLES, parseCsv } from './atlas-data.mjs';
import { JOURNEYS, JOURNEY_HEADERS,dateBounds } from './travel-layers.mjs';

// 将历史“长期阶段/候选城市表”误挂到后续旅行的交通记录拆出。
// 这里只处理可证实的日期越界；没有足够证据的路线单独成闭环片段，
// 不把它们硬塞进另一趟旅行。

const inRange = (date, scope) => {
  const a=dateBounds(date),b=dateBounds(scope);
  return !a||!b||(a.end>=b.start&&a.start<=b.end);
};
const split = value => String(value || '').split('；').filter(Boolean);

export async function buildRepairInput(vault,{targets={},groups={},source:sourceOverride,config}={}) {
  const source=await resolveSource({vault,source:sourceOverride,config:config||(vault?{vault}:undefined)});
  const [groundRows, journeyRows] = await Promise.all([
    readFile(sourcePath(source,TABLES.ground), 'utf8').then(parseCsv),
    readFile(sourcePath(source,JOURNEYS), 'utf8').then(parseCsv),
  ]);
  const owners = new Map();
  for (const row of journeyRows) for (const id of split(row['关联交通编号'])) owners.set(id, row['行程编号']);
  const patches = new Map(journeyRows.map(row => [row['行程编号'], { ...row }]));
  for (const [id, group] of Object.entries(groups)) {
    if(!patches.has(id))throw new Error('闭环组关联行程不存在：'+id);
    patches.get(id)['闭环组编号'] = group;
  }
  const added = [];
  let counter = 0;

  const newJourney = (route, oldOwner) => {
    const id = `J-LEG-${route['交通编号']}`;
    if (patches.has(id)) return id;
    const names = split(route['途经节点']);
    const source = route['关联正文'];
    patches.set(id, {
      '行程编号': id,
      '行程名称': `地面活动：${names.join('—')}`,
      '出发基地地点编号': '',
      '出发基地': names[0] || '',
      '日期或区间': route['日期或区间'],
      '日期精度': route['日期精度'] || route['时间精度'] || '沿用交通记录精度',
      '重构状态': '来源归组',
      '行程依据': `按交通记录 ${route['交通编号']} 的日期与来源单列，原归属 ${oldOwner || '未登记'} 不在同一日期范围；路线本身保留原事实。`,
      '关联交通编号': route['交通编号'],
      '关联正文': source,
      '分享纳入': route['分享纳入'] || '纳入',
      '备注': '日期范围修复：独立地面片段；不因单列而增加新旅行事实。',
    });
    added.push(id);
    return id;
  };

  for (const route of groundRows) {
    const id = route['交通编号'];
    const owner = owners.get(id);
    if (!owner || inRange(route['日期或区间'], patches.get(owner)?.['日期或区间'])) continue;
    const candidates=journeyRows.filter(j=>j['行程编号']!==owner&&inRange(route['日期或区间'],j['日期或区间'])&&
      split(route['关联正文']).some(source=>split(j['关联正文']).includes(source)));
    const target=targets[id]||(candidates.length===1?candidates[0]['行程编号']:newJourney(route,owner));
    const old = patches.get(owner);
    if (old) old['关联交通编号'] = split(old['关联交通编号']).filter(x => x !== id).join('；');
    if (!added.includes(target)) {
      const next = patches.get(target);
      if (!next) throw new Error(`目标行程不存在：${target}（${id}）`);
      if(!inRange(route['日期或区间'],next['日期或区间']))throw new Error('目标行程仍日期越界：'+id+'→'+target);
      const ids = split(next['关联交通编号']);
      if (!ids.includes(id)) next['关联交通编号'] = [...ids, id].join('；');
    }
    counter++;
  }

  const changed = [...patches.values()].filter(row => {
    const old = journeyRows.find(x => x['行程编号'] === row['行程编号']);
    return !old || JOURNEY_HEADERS.some(h => old[h] !== row[h]);
  });
  return { version: 1, journeys: changed, meta: { moved: counter, added, generatedAt: new Date().toISOString() } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { vault: { type: 'string' }, mapping:{type:'string'},output: { type: 'string', default: 'inputs/repair-journey-scope.json' },write:{type:'boolean',default:false} } });
  const cfg=await readAtlasConfig();
  const input=await buildRepairInput(values.vault,{...(values.mapping?await readJson(resolve(values.mapping)):{}),config:cfg});
  const { meta, ...patch } = input;
  if(values.write){
    await mkdir(resolve(values.output,'..'),{recursive:true});
    await writeFile(resolve(values.output),JSON.stringify(patch,null,2)+'\n');
  }
  console.log(JSON.stringify({ output: values.write?resolve(values.output):null, ...meta,patch }, null, 2));
}
