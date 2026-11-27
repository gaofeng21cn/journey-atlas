#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CARRIER = path.join(ROOT, 'plugins', 'travel-passport');

async function json(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function isSafeRelative(relative) {
  return typeof relative === 'string'
    && relative.length > 0
    && !path.isAbsolute(relative)
    && relative.split('/').every(segment => segment && segment !== '.' && segment !== '..')
    && !relative.includes('\\');
}

const runtime = await json(path.join(ROOT, 'package-runtime-files.json'));
const privatePath = /^(?:inputs|private|outputs|node_modules)\/|^data\/(?:source|history|site-cache)\/|^data\/(?:profile|atlas-config|annual-config|geocode-cache)\.json$/;
if (runtime.schema_version !== 'journey-atlas.runtime-files.v1'
  || !Array.isArray(runtime.paths)
  || !runtime.paths.includes('opl-package.json')
  || runtime.paths.some(relative => !isSafeRelative(relative) || privatePath.test(relative))
  || new Set(runtime.paths).size !== runtime.paths.length) {
  throw new Error('Invalid public runtime inventory.');
}

const duplicatedAtRoot = runtime.paths.filter(relative => relative !== 'package.json' && existsSync(path.join(ROOT, relative)));
if (duplicatedAtRoot.length) {
  throw new Error(`Duplicate runtime files found outside plugins/travel-passport/: ${duplicatedAtRoot.slice(0, 5).join(', ')}`);
}

const manifest = await json(path.join(CARRIER, 'opl-package.json'));
const [rootPkg, carrierPkg, carrierLock] = await Promise.all([
  json(path.join(ROOT, 'package.json')),
  json(path.join(CARRIER, 'package.json')),
  json(path.join(CARRIER, 'package-lock.json')),
]);
const version = manifest.identity?.version;
const versionsAligned = typeof version === 'string' && version.length > 0
  && [rootPkg.version, carrierPkg.version, carrierLock.version, carrierLock.packages?.['']?.version]
    .every(candidate => candidate === version);
if (manifest.schema_version !== 'opl.package.v2' || manifest.identity?.id !== 'travel-passport') {
  throw new Error('plugins/travel-passport/opl-package.json must be an OPL package v2 manifest.');
}
if (Object.hasOwn(manifest, 'content_lock')) {
  throw new Error('OPL package v2 does not use the legacy content_lock field.');
}
const obsoleteMetadata = ['app-contribution-adapter.json', 'plugin.json', '.codex-plugin/plugin.json']
  .filter(relative => existsSync(path.join(CARRIER, relative)));
if (obsoleteMetadata.length) {
  throw new Error(`Obsolete v1 package metadata remains: ${obsoleteMetadata.join(', ')}`);
}
await Promise.all(runtime.paths.map(async relative => {
  if (!(await lstat(path.join(CARRIER, relative))).isFile()) {
    throw new Error(`Expected a public runtime file: ${relative}`);
  }
}));

process.stdout.write(JSON.stringify({
  status: versionsAligned ? 'passed' : 'stale',
  schema_version: manifest.schema_version,
  versions_aligned: versionsAligned,
  payload_files: runtime.paths.length,
}) + '\n');
if (!versionsAligned) process.exitCode = 2;
