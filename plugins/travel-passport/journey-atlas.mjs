#!/usr/bin/env node
import { createRequire } from 'node:module';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, rmdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));

function physicalTarget(target) {
  try { return realpathSync(target); }
  catch (error) {
    if (error.code !== 'ENOENT' || dirname(target) === target) throw error;
    return join(physicalTarget(dirname(target)), basename(target));
  }
}

function run(command, args, { env = process.env, setup = false } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: packageRoot, env, stdio: ['inherit', setup ? 2 : 1, 2] });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolveRun() : reject(new Error(`${command} exited with ${code}`)));
  });
}

export function dependenciesReady() {
  const lock = JSON.parse(readFileSync(join(packageRoot, 'package-lock.json'), 'utf8'));
  return Object.keys(manifest.dependencies).every(name => {
    try {
      const installed = JSON.parse(readFileSync(join(packageRoot, 'node_modules', name, 'package.json'), 'utf8'));
      return installed.version === lock.packages[`node_modules/${name}`]?.version;
    } catch { return false; }
  });
}

export async function setupRuntime({ browser = false } = {}) {
  if (!dependenciesReady()) {
    const lock = join(packageRoot, '.journey-atlas-setup.lock');
    try { await mkdir(lock); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('Journey Atlas dependency setup is already running. Retry after it finishes.'); throw error; }
    try {
      process.stderr.write('Preparing Journey Atlas dependencies from package-lock.json…\n');
      await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { setup: true });
      if (!dependenciesReady()) throw new Error('Journey Atlas dependency readback failed.');
    } finally { await rmdir(lock); }
  }
  if (browser && !process.env.PASSPORT_BROWSER_CHANNEL && !existsSync('/Applications/Google Chrome.app')) {
    const { chromium } = require('playwright');
    if (!existsSync(chromium.executablePath())) {
      await run(process.execPath, [join(packageRoot, 'node_modules/playwright/cli.js'), 'install', 'chromium'], { setup: true });
    }
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Journey Atlas requires Node.js 22 or later.');
  const args = [...argv];
  let workspace = process.env.JOURNEY_ATLAS_WORKSPACE || process.env.OPL_PROFILE_WORKSPACE;
  const index = args.indexOf('--workspace');
  if (index >= 0) {
    if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error('--workspace needs a directory.');
    workspace = args[index + 1]; args.splice(index, 2);
  }
  const command = args.shift() || 'help';
  if (['version', '--version'].includes(command)) {
    process.stdout.write(JSON.stringify({ package_id: 'travel-passport', display_name: 'Journey Atlas', version: manifest.version, runtime_root: packageRoot }) + '\n'); return;
  }
  if (['help', '--help'].includes(command)) {
    process.stdout.write('Journey Atlas\n  node journey-atlas.mjs --workspace <directory> <init|import|status|check|trace|update|receipt|build|site|annual|verify> [options]\n  node journey-atlas.mjs setup [--browser]\n  node journey-atlas.mjs version\n\nThe selected package supplies code. The workspace supplies private configuration and data.\n'); return;
  }
  if (command === 'setup') {
    if (args.some(arg => arg !== '--browser')) throw new Error('setup accepts only --browser.');
    await setupRuntime({ browser: args.includes('--browser') });
    process.stdout.write(JSON.stringify({ status: 'ready', version: manifest.version, dependencies: 'package-lock.json' }) + '\n'); return;
  }
  const entry = {
    init: ['scripts/source-data-cli.mjs', 'init'], import: ['scripts/source-data-cli.mjs', 'import'],
    status: ['scripts/passport.mjs', 'status'], check: ['scripts/passport.mjs', 'check'],
    trace: ['scripts/passport.mjs', 'trace'], update: ['scripts/passport.mjs', 'update'],
    receipt: ['scripts/passport.mjs', 'receipt'], build: ['scripts/passport.mjs', 'build'],
    site: ['scripts/site.mjs'], annual: ['scripts/render-annual.mjs'], verify: ['scripts/verify-all.mjs'],
  }[command];
  if (!entry) throw new Error(`Unknown command: ${command}`);
  if (!workspace) throw new Error('Select a Journey Atlas workspace with --workspace or the OPL workspace binding.');
  workspace = physicalTarget(resolve(workspace));
  const fromPackage = relative(packageRoot, workspace);
  if (!fromPackage || !isAbsolute(fromPackage) && fromPackage !== '..' && !fromPackage.startsWith('..' + sep)) throw new Error('Keep the managed workspace outside the installed package. Use npm scripts for an explicit source checkout.');
  const config = join(workspace, 'data/atlas-config.json');
  if (!['init', 'import'].includes(command) && !existsSync(config)) throw new Error('The workspace is not configured. Initialize it or bind its existing Obsidian/source configuration.');
  if (args.includes('--root')) throw new Error('Use --workspace to select the data workspace.');
  const needsBrowser = command === 'build' || command === 'annual' || command === 'verify'
    || command === 'update' && !args.includes('--dry-run') && !args.includes('--no-render')
    || command === 'site' && (args[0] === 'check' || args.includes('png'));
  await setupRuntime({ browser: needsBrowser });
  const env = { ...process.env, JOURNEY_ATLAS_WORKSPACE: workspace, TRAVEL_PASSPORT_CONFIG: config };
  await run(process.execPath, [...entry, ...args, ...(['init', 'import'].includes(command) ? ['--root', workspace] : [])], { env });
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  process.stderr.write(`${error.message}\n`); process.exitCode = 1;
});
