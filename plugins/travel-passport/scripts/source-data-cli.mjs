#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { initializeDataSource, importSourceBundle } from './source-data.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { source: { type: 'string', default: 'data/source' }, root:{type:'string'}, input: { type: 'string' }, replace: { type: 'boolean', default: false }, help:{type:'boolean',default:false} },
});
const command = positionals[0] || 'init';
if(values.help){process.stdout.write('用法：npm run init:data -- [--root <workspace>] [--source data/source]\n      npm run import:data -- --input <bundle.json> [--root <workspace>] [--source data/source]\n');process.exit(0);}
if (command === 'init') {
  const result = await initializeDataSource({ workspaceRoot:values.root, sourceDir: values.source, writeConfig: true });
  process.stdout.write(JSON.stringify({ command, source: result.folder, files: result.files }, null, 2) + '\n');
} else if (command === 'import') {
  if (!values.input) throw new Error('import 需要 --input <bundle.json>');
  const bundle = JSON.parse(await readFile(values.input, 'utf8'));
  const result = await importSourceBundle({ workspaceRoot:values.root, sourceDir: values.source, bundle, replace: values.replace, writeConfig: true });
  process.stdout.write(JSON.stringify({ command, source: result.folder, imported: result.imported }, null, 2) + '\n');
} else {
  throw new Error('用法：node scripts/source-data-cli.mjs init [--source dir]；import --input bundle.json [--source dir]');
}
