#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CARRIER = path.join(ROOT, 'plugins', 'travel-passport');
const check = process.argv.includes('--check');

async function files(root, relative = '') {
  const result = [];
  const directory = path.join(root, relative);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const next = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await files(root, next));
    else if (entry.isFile() && entry.name !== 'opl-package.json') result.push(next);
  }
  return result.sort();
}

async function json(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function digestFor(paths, bodies) {
  const digest = createHash('sha256');
  for (const relative of paths) {
    const encoded = Buffer.from(relative);
    const body = bodies.get(relative);
    const pathLength = Buffer.alloc(8);
    const bodyLength = Buffer.alloc(8);
    pathLength.writeBigUInt64BE(BigInt(encoded.length));
    bodyLength.writeBigUInt64BE(BigInt(body.length));
    digest.update(pathLength).update(encoded).update(bodyLength).update(body);
  }
  return `sha256:${digest.digest('hex')}`;
}

if (!check) {
  await mkdir(path.join(CARRIER, '.codex-plugin'), { recursive: true });
  await mkdir(path.join(CARRIER, 'skills', 'travel-planning'), { recursive: true });
  for (const [source, target] of [
    ['app-contribution-adapter.json', 'app-contribution-adapter.json'],
    ['app-contribution.mjs', 'app-contribution.mjs'],
  ]) await cp(path.join(ROOT, source), path.join(CARRIER, target));
  await mkdir(path.join(CARRIER, 'docs'), { recursive: true });
  for (const name of ['架构与数据边界.md', '维护流程.md', '输入目录约定.md']) {
    await cp(path.join(ROOT, 'docs', name), path.join(CARRIER, 'docs', name));
  }
  await cp(
    path.join(ROOT, 'skills', 'travel-planning', 'SKILL.md'),
    path.join(CARRIER, 'skills', 'travel-planning', 'SKILL.md'),
  );
}

const paths = await files(CARRIER);
const bodies = new Map(await Promise.all(paths.map(async (relative) => (
  [relative, await readFile(path.join(CARRIER, relative))]
))));
const contentLock = {
  algorithm: 'sha256',
  canonicalization: 'ordered_path_length_file_length_bytes',
  paths,
  digest: digestFor(paths, bodies),
};
const rootManifestPath = path.join(ROOT, 'opl-package.json');
const carrierManifestPath = path.join(CARRIER, 'opl-package.json');
const rootManifest = await json(rootManifestPath);
rootManifest.content_lock = contentLock;
if (check) {
  const carrierManifest = await json(carrierManifestPath);
  const ok = rootManifest.content_lock.digest === carrierManifest.content_lock.digest
    && JSON.stringify(rootManifest) === JSON.stringify(carrierManifest);
  process.stdout.write(JSON.stringify({ status: ok ? 'passed' : 'stale' }) + '\n');
  process.exitCode = ok ? 0 : 2;
} else {
  await writeFile(carrierManifestPath, `${JSON.stringify(rootManifest, null, 2)}\n`);
  await writeFile(rootManifestPath, `${JSON.stringify(rootManifest, null, 2)}\n`);
  process.stdout.write(JSON.stringify({ status: 'passed' }) + '\n');
}
