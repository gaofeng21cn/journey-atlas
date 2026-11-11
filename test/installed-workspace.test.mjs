import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ROOT } from '../scripts/data.mjs';

test('installed CLI and shared view execute their own runtime against an independent data workspace', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'journey-installed-workspace-'));
  const env = { ...process.env, OPL_PROFILE_WORKSPACE: workspace, JOURNEY_ATLAS_WORKSPACE: workspace };
  delete env.TRAVEL_PASSPORT_CONFIG;
  const run = args => execFileSync(process.execPath, ['journey-atlas.mjs', '--workspace', workspace, ...args], { cwd: ROOT, env, encoding: 'utf8' });
  try {
    assert.equal(JSON.parse(run(['version'])).package_id, 'travel-passport');
    run(['init']);
    await mkdir(join(workspace, 'examples'));
    await writeFile(join(workspace, 'examples/source-note.md'), await readFile(join(ROOT, 'examples/source-note.md')));
    run(['import', '--input', join(ROOT, 'examples/import-bundle.json')]);
    const status = JSON.parse(run(['status', '--json']));
    assert.ok(status.sharing.totalKm > 0);
    assert.equal(JSON.parse(run(['check', '--json'])).quality.structuralErrors, 0);
    const sourceBefore = await readFile(join(workspace, 'data/source/places.csv'));
    const site = JSON.parse(run(['site', 'build']));
    assert.ok(site.output.startsWith(realpathSync(workspace)));
    assert.deepEqual(await readFile(join(workspace, 'data/source/places.csv')), sourceBefore);

    // A data directory is never promoted to code authority, even if it has a
    // package.json and a similarly named status script.
    await mkdir(join(workspace, 'scripts'));
    await writeFile(join(workspace, 'package.json'), JSON.stringify({ name: 'travel-passport' }));
    await writeFile(join(workspace, 'scripts/passport.mjs'), "throw new Error('WORKSPACE_CODE_MUST_NOT_EXECUTE');\n");
    const result = JSON.parse(execFileSync(process.execPath, ['app-contribution.mjs'], { cwd: ROOT, env, encoding: 'utf8', input: JSON.stringify({ schema_version: 'opl-package-app-contribution-request.v1', operation: 'read', ref: 'travel.passport.v1#status', input: {} }) }));
    assert.equal(result.ok, true);
    assert.equal(result.result.data.status.sharing.totalKm, status.sharing.totalKm);

    const code = `import {resolveSource} from './scripts/source-data.mjs';
      import {updateSourceSnapshot,applySourceUpdate} from './scripts/update-operation.mjs';
      const source=await resolveSource();
      const snapshot=await updateSourceSnapshot(source.folder,source);
      console.log(JSON.stringify(await applySourceUpdate({folder:source.folder,source,snapshot,changes:[],report:{},operationId:'installed-workspace-test'})));`;
    const receipt = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: ROOT, env, encoding: 'utf8' }));
    assert.ok(receipt.receipt.startsWith(workspace));
    const inspection = JSON.parse(run(['receipt', '--id', 'installed-workspace-test', '--json']));
    assert.equal(inspection.readback.sourceState, 'matches_applied');
    assert.deepEqual(await readFile(join(workspace, 'data/source/places.csv')), sourceBefore);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('workspace selection is required and never defaults to the installed package', async () => {
  const env = { ...process.env }; delete env.OPL_PROFILE_WORKSPACE; delete env.JOURNEY_ATLAS_WORKSPACE; delete env.TRAVEL_PASSPORT_CONFIG;
  const missing = spawnSync(process.execPath, ['journey-atlas.mjs', 'status', '--json'], { cwd: ROOT, env, encoding: 'utf8' });
  assert.notEqual(missing.status, 0); assert.match(missing.stderr, /Select a Journey Atlas workspace/);
  const inside = spawnSync(process.execPath, ['journey-atlas.mjs', '--workspace', ROOT, 'init'], { cwd: ROOT, env, encoding: 'utf8' });
  assert.notEqual(inside.status, 0); assert.match(inside.stderr, /outside the installed package/);
  const temporary = await mkdtemp(join(tmpdir(), 'journey-install-alias-'));
  try {
    await symlink(ROOT, join(temporary, 'alias'));
    const alias = spawnSync(process.execPath, ['journey-atlas.mjs', '--workspace', join(temporary, 'alias/new-workspace'), 'init'], { cwd: ROOT, env, encoding: 'utf8' });
    assert.notEqual(alias.status, 0); assert.match(alias.stderr, /outside the installed package/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
