import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { ROOT } from './data.mjs';
for(const folder of ['scripts','src'])for(const file of await readdir(new URL('../'+folder+'/',import.meta.url))){
  if(/\.(mjs|js)$/.test(file))execFileSync(process.execPath,['--check',folder+'/'+file],{cwd:ROOT,stdio:'inherit'});
}
console.log('全部 JavaScript 语法检查通过');
