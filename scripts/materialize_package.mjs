#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
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

// This explicit inventory is the public runtime boundary. Canonical runtime
// files live solely under plugins/travel-passport/ (single-source layout).
// Never walk the developer workspace, ignored files, personal configuration, or node_modules.
const runtime = await json(path.join(ROOT, 'package-runtime-files.json'));
const privatePath = /^(?:inputs|private|outputs|node_modules)\/|^data\/(?:source|history|site-cache)\/|^data\/(?:profile|atlas-config|annual-config|geocode-cache)\.json$/;
if (runtime.schema_version !== 'journey-atlas.runtime-files.v1' || !Array.isArray(runtime.paths)
  || runtime.paths.some(relative => typeof relative !== 'string' || path.isAbsolute(relative)
    || relative.split('/').includes('..') || privatePath.test(relative))
  || new Set(runtime.paths).size !== runtime.paths.length) throw new Error('Invalid public runtime inventory.');

// Guard against checked-in mirror duplication creeping back at the repo root.
const duplicatedAtRoot = [
  ...(existsSync(path.join(ROOT, 'opl-package.json')) ? ['opl-package.json'] : []),
  ...runtime.paths.filter(relative => relative !== 'package.json' && existsSync(path.join(ROOT, relative))),
];
if (duplicatedAtRoot.length) {
  throw new Error(`Duplicate runtime files found outside plugins/travel-passport/: ${duplicatedAtRoot.slice(0, 5).join(', ')}`);
}

const metadata = ['.codex-plugin/plugin.json', 'plugin.json'];
const paths = [...runtime.paths, ...metadata].sort();
const bodies = new Map(await Promise.all(paths.map(async relative => [
  relative,
  await readFile(path.join(CARRIER, relative)),
])));

const contentLock = {
  algorithm: 'sha256',
  canonicalization: 'ordered_path_length_file_length_bytes',
  paths,
  digest: digestFor(paths, bodies),
};

const carrierManifestPath = path.join(CARRIER, 'opl-package.json');
const carrierManifest = await json(carrierManifestPath);
const expectedManifest = { ...carrierManifest, content_lock: contentLock };

if (check) {
  const [rootPkg, carrierPkg, carrierLock, pluginMeta, codexPluginMeta] = await Promise.all([
    json(path.join(ROOT, 'package.json')),
    json(path.join(CARRIER, 'package.json')),
    json(path.join(CARRIER, 'package-lock.json')),
    json(path.join(CARRIER, 'plugin.json')),
    json(path.join(CARRIER, '.codex-plugin', 'plugin.json')),
  ]);
  const versionsMatch = [
    rootPkg.version,
    carrierPkg.version,
    carrierLock.version,
    pluginMeta.version,
    codexPluginMeta.version,
  ].every(version => version === carrierManifest.version);
  const lockMatches = carrierManifest.content_lock?.digest === contentLock.digest
    && JSON.stringify(carrierManifest.content_lock?.paths) === JSON.stringify(contentLock.paths);
  const ok = versionsMatch && lockMatches;
  process.stdout.write(JSON.stringify({
    status: ok ? 'passed' : 'stale',
    versions_aligned: versionsMatch,
    content_lock_aligned: lockMatches,
    payload_files: paths.length,
  }) + '\n');
  process.exitCode = ok ? 0 : 2;
} else {
  await writeFile(carrierManifestPath, `${JSON.stringify(expectedManifest, null, 2)}\n`);
  process.stdout.write(JSON.stringify({ status: 'passed', payload_files: paths.length }) + '\n');
}
