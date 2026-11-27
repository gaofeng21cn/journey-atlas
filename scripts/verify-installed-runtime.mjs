#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, lstat, mkdtemp, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'journey-release-acceptance-'));
const installation = join(temporary, 'installed');
const workspace = join(temporary, 'workspace');
const environment = { ...process.env, JOURNEY_ATLAS_WORKSPACE: workspace, OPL_PROFILE_WORKSPACE: workspace };
delete environment.TRAVEL_PASSPORT_CONFIG;
const runInstalled = args => execFileSync(process.execPath, ['journey-atlas.mjs', '--workspace', workspace, ...args], {
  cwd: installation, env: environment, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
});
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  const source = join(REPO_ROOT, 'plugins/travel-passport');
  const inventory = JSON.parse(await readFile(join(REPO_ROOT, 'package-runtime-files.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(source, 'opl-package.json'), 'utf8'));
  assert.equal(manifest.schema_version, 'opl.package.v2');
  assert.equal(manifest.identity.id, 'travel-passport');
  for (const name of inventory.paths) {
    await mkdir(dirname(join(installation, name)), { recursive: true });
    await cp(join(source, name), join(installation, name));
  }
  const version = JSON.parse(runInstalled(['version']));
  assert.equal(version.package_id, manifest.identity.id);
  assert.equal(version.version, manifest.identity.version);

  const handler = manifest.provides.contribution_handler;
  assert.equal(handler.kind, 'cli');
  assert.equal(handler.transport, 'stdin_json_stdout_json');
  const [command, ...args] = handler.argv;
  const views = new Map(manifest.ui.declarative.views.map(view => [view.id, view]));
  const statusView = views.get('travel.passport.status');
  const annualView = views.get('travel.passport.annual');
  const setupRef = statusView.actions.find(action => action.id === 'travel.passport.setup').action_ref;
  const generateRef = annualView.actions.find(action => action.id === 'travel.passport.annual.generate').action_ref;
  const callContribution = (operation, ref, input = {}, nativeAction = false) => {
    const request = {
      schema_version: 'opl-package-app-contribution-request.v1',
      package_id: manifest.identity.id,
      operation,
      ...(nativeAction ? { action_id: ref, payload: input, dry_run: false } : { ref, input }),
    };
    const response = JSON.parse(execFileSync(command, args, {
      cwd: installation, env: environment, encoding: 'utf8', input: JSON.stringify(request),
    }));
    assert.equal(response.schema_version, 'opl-package-app-contribution-response.v1');
    assert.equal(response.ok, true);
    assert.equal(response.operation, operation);
    assert.equal(response.ref, ref);
    return response.result;
  };
  const readOnly = callContribution('read', statusView.data_ref);
  assert.equal(readOnly.state, 'input_required');
  assert.equal(readOnly.data.action_ref, setupRef);
  await assert.rejects(lstat(join(installation, 'node_modules')), { code: 'ENOENT' });
  const setupAction = callContribution('execute', setupRef);
  assert.equal(setupAction.state, 'ready');
  assert.equal(callContribution('execute', setupRef, {}, true).state, 'ready');
  runInstalled(['init']);
  await mkdir(join(workspace, 'examples'));
  await cp(join(installation, 'examples/source-note.md'), join(workspace, 'examples/source-note.md'));
  runInstalled(['import', '--input', join(installation, 'examples/import-bundle.json')]);
  const original = digest(await readFile(join(workspace, 'data/source/places.csv')));
  const check = JSON.parse(runInstalled(['check', '--json']));
  assert.equal(check.quality.structuralErrors, 0);
  runInstalled(['build', '--scope', 'world', '--variant', 'social']);
  const year = 2020; // Year of the trip in examples/import-bundle.json.
  const annualAction = callContribution('execute', generateRef, { year, theme: 'travel', style: 'night', format: 'single' });
  assert.equal(annualAction.state, 'ready');
  assert.equal(annualAction.data.pageCount, 1);
  const annual = callContribution('read', annualView.data_ref, { year });
  assert.deepEqual(annual.data.command_inputs[generateRef].input_schema.required, ['year']);
  const card = annual.data.items.find(item => item.page_count === 1);
  assert.ok(card?.artifacts.some(artifact => artifact.media_type === 'image/png'));
  const status = callContribution('read', statusView.data_ref);
  assert.equal(status.data.status.build.state, 'fresh');
  const overview = callContribution('read', views.get('travel.passport.overview').data_ref);
  assert.ok(overview.data.items[0].artifacts.length >= 2);
  const regions = callContribution('read', views.get('travel.passport.regions').data_ref);
  assert.ok(regions.data.items.length > 0);
  assert.equal(digest(await readFile(join(workspace, 'data/source/places.csv'))), original);
  for (const name of inventory.paths) assert.equal(digest(await readFile(join(installation, name))), digest(await readFile(join(source, name))), name);
  await rm(installation, { recursive: true });
  assert.equal(digest(await readFile(join(workspace, 'data/source/places.csv'))), original);
  const output = JSON.parse(await readFile(join(workspace, 'outputs/site/build-check.json'), 'utf8'));
  assert.ok(output.routes > 0);
  process.stdout.write(JSON.stringify({
    status: 'passed',
    package_id: manifest.identity.id,
    version: manifest.identity.version,
    dependency_setup: 'npm ci --ignore-scripts',
    independent_workspace: true,
    source_integrity: 'preserved',
    active_carrier_code_only: true,
    cli_and_shared_view: true,
    direct_actions: [setupRef, generateRef],
    rendered_output: true,
    uninstall_preserves_workspace: true,
    payload_files: inventory.paths.length,
  }, null, 2) + '\n');
} finally { await rm(temporary, { recursive: true, force: true }); }
