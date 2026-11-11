#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CARRIER = path.join(ROOT, 'plugins', 'travel-passport');
const check = process.argv.includes('--check');

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

// This explicit inventory is the public runtime boundary. Never walk the
// developer workspace, ignored files, personal configuration, or node_modules.
const runtime = await json(path.join(ROOT, 'package-runtime-files.json'));
const privatePath = /^(?:inputs|private|outputs|node_modules)\/|^data\/(?:source|history|site-cache)\/|^data\/(?:profile|atlas-config|annual-config|geocode-cache)\.json$/;
if (runtime.schema_version !== 'journey-atlas.runtime-files.v1' || !Array.isArray(runtime.paths)
  || runtime.paths.some(relative => typeof relative !== 'string' || path.isAbsolute(relative)
    || relative.split('/').includes('..') || privatePath.test(relative))
  || new Set(runtime.paths).size !== runtime.paths.length) throw new Error('Invalid public runtime inventory.');
const metadata = ['.codex-plugin/plugin.json', 'plugin.json'];
const paths = [...runtime.paths, ...metadata].sort();
const bodies = new Map(await Promise.all(paths.map(async relative => [relative,
  await readFile(path.join(metadata.includes(relative) ? CARRIER : ROOT, relative))])));
if (!check) for (const relative of runtime.paths) {
  await mkdir(path.dirname(path.join(CARRIER, relative)), { recursive: true });
  await writeFile(path.join(CARRIER, relative), bodies.get(relative));
}
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
  const copiesMatch = (await Promise.all(paths.map(async relative => (
    await readFile(path.join(CARRIER, relative)).catch(() => Buffer.alloc(0))
  ).equals(bodies.get(relative))))).every(Boolean);
  const storedRootManifest = await json(rootManifestPath);
  const ok = copiesMatch && storedRootManifest.content_lock.digest === contentLock.digest
    && rootManifest.content_lock.digest === carrierManifest.content_lock.digest
    && JSON.stringify(rootManifest) === JSON.stringify(carrierManifest);
  process.stdout.write(JSON.stringify({ status: ok ? 'passed' : 'stale' }) + '\n');
  process.exitCode = ok ? 0 : 2;
} else {
  await writeFile(carrierManifestPath, `${JSON.stringify(rootManifest, null, 2)}\n`);
  await writeFile(rootManifestPath, `${JSON.stringify(rootManifest, null, 2)}\n`);
  process.stdout.write(JSON.stringify({ status: 'passed' }) + '\n');
}
