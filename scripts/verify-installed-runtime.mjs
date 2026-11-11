#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './data.mjs';

const temporary = await mkdtemp(join(tmpdir(), 'journey-release-acceptance-'));
const installation = join(temporary, 'installed');
const workspace = join(temporary, 'workspace');
const environment = { ...process.env, JOURNEY_ATLAS_WORKSPACE: workspace, OPL_PROFILE_WORKSPACE: workspace };
delete environment.TRAVEL_PASSPORT_CONFIG;
const execute = args => execFileSync(process.execPath, [join(installation, 'journey-atlas.mjs'), '--workspace', workspace, ...args], { cwd: temporary, env: environment, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024 });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  const source = join(ROOT, 'plugins/travel-passport');
  const manifest = JSON.parse(await readFile(join(source, 'opl-package.json'), 'utf8'));
  // Materialize exactly the published payload without any developer node_modules.
  for (const name of [...manifest.content_lock.paths, 'opl-package.json']) {
    await mkdir(join(installation, name, '..'), { recursive: true });
    await cp(join(source, name), join(installation, name));
  }
  const readOnly = JSON.parse(execFileSync(process.execPath, [join(installation, 'app-contribution.mjs')], { cwd: temporary, env: environment, encoding: 'utf8', input: JSON.stringify({ schema_version: 'opl-package-app-contribution-request.v1', operation: 'read', ref: 'travel.passport.v1#status', input: {} }) }));
  assert.equal(readOnly.result.state, 'input_required');
  assert.equal(readOnly.result.data.action_ref, 'travel.passport.v1#runtime.setup');
  await assert.rejects(readFile(join(installation, 'node_modules/package.json')), { code: 'ENOENT' });
  const setup = JSON.parse(execute(['setup'])); assert.equal(setup.status, 'ready');
  execute(['init']);
  await mkdir(join(workspace, 'examples'));
  await cp(join(installation, 'examples/source-note.md'), join(workspace, 'examples/source-note.md'));
  execute(['import', '--input', join(installation, 'examples/import-bundle.json')]);
  const original = digest(await readFile(join(workspace, 'data/source/places.csv')));
  const check = JSON.parse(execute(['check', '--json'])); assert.equal(check.quality.structuralErrors, 0);
  execute(['build', '--scope', 'world', '--variant', 'social']);
  const status = JSON.parse(execute(['status', '--json'])); assert.equal(status.build.state, 'fresh');
  const view = JSON.parse(execFileSync(process.execPath, [join(installation, 'app-contribution.mjs')], { cwd: temporary, env: environment, encoding: 'utf8', input: JSON.stringify({ schema_version: 'opl-package-app-contribution-request.v1', operation: 'read', ref: 'travel.passport.v1#overview', input: {} }) }));
  assert.equal(view.ok, true); assert.ok(view.result.data.items[0].artifacts.length >= 2);
  assert.equal(digest(await readFile(join(workspace, 'data/source/places.csv'))), original);
  for (const name of manifest.content_lock.paths) assert.equal(digest(await readFile(join(installation, name))), digest(await readFile(join(source, name))), name);
  await rm(installation, { recursive: true });
  assert.equal(digest(await readFile(join(workspace, 'data/source/places.csv'))), original);
  const output = JSON.parse(await readFile(join(workspace, 'outputs/site/build-check.json'), 'utf8'));
  assert.ok(output.routes > 0);
  process.stdout.write(JSON.stringify({ status: 'passed', package_id: manifest.package_id, version: manifest.version, dependency_setup: 'npm ci --ignore-scripts', independent_workspace: true, source_integrity: 'preserved', active_carrier_code_only: true, cli_and_shared_view: true, rendered_output: true, uninstall_preserves_workspace: true, payload_files: manifest.content_lock.paths.length }, null, 2) + '\n');
} finally { await rm(temporary, { recursive: true, force: true }); }
