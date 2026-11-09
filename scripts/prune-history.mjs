// Keeps the automatic rollback area bounded.
//
// `npm run update` writes a copy of every changed source table into
// data/history/<timestamp>-<kind>/ before it overwrites the maintained file.
// Those copies are recovery aids, not a second source of truth: the current
// tables always live in the vault. Without a retention rule the folder grows
// without limit and every later audit has to wade through superseded copies.
//
// This prunes only directories that match the automatic backup pattern and
// keeps the newest ones. Anything older is reported and removed. Recoverable
// snapshots someone explicitly wants to keep belong in private/history, not
// here, so this never touches files outside the pattern.
import {readdir, rm, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {ROOT} from './data.mjs';

const HISTORY = join(ROOT, 'data/history');
export const HISTORY_KEEP=12;
// <ISO-with-dashes>-<kind>; the kinds are the ones the three writers emit.
const BACKUP = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-(atlas|cities|global-observations|city-detail|node-continuity|formal-node-edges|promote-candidates|sea-2012|layers)$/;

export async function pruneHistory({keep = HISTORY_KEEP, apply = true, dir = HISTORY} = {}) {
  if(!Number.isSafeInteger(keep)||keep<1)throw new Error('保留份数必须为正整数');
  const entries = await readdir(dir, {withFileTypes: true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
  const backups = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !BACKUP.test(entry.name)) continue;
    const path = join(dir, entry.name);
    const info = await stat(path);
    backups.push({name: entry.name, path, mtimeMs: info.mtimeMs});
  }
  // Newest first: the timestamp is embedded, but fall back to mtime so a
  // clock-skewed or copied folder is still ordered deterministically.
  backups.sort((a, b) => b.name.localeCompare(a.name) || b.mtimeMs - a.mtimeMs);
  const stale = backups.slice(keep);
  if (apply) for (const item of stale) await rm(item.path, {recursive: true, force: true});
  return {kept: backups.slice(0, keep).length, removed: stale.map(item => item.name), total: backups.length};
}

// Cleanup failure must be visible, but cannot undo a committed source update.
export async function maintainHistory(){
  try{return await pruneHistory();}
  catch(error){console.warn('维护源已保存；回滚副本清理失败：'+error.message);return {error:error.message};}
}

if (process.argv[1]&&import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const {values}=parseArgs({options:{keep:{type:'string'},'dry-run':{type:'boolean',default:false}}});
  const keep=values.keep===undefined?HISTORY_KEEP:Number(values.keep),dryRun=values['dry-run'];
  const report = await pruneHistory({keep, apply: !dryRun});
  console.log(JSON.stringify({dryRun, keep, ...report}, null, 2));
}
