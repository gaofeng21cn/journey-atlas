import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join, resolve } from 'node:path';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
function defaultWorkspaceRoot() {
  if (process.env.JOURNEY_ATLAS_WORKSPACE) return resolve(process.env.JOURNEY_ATLAS_WORKSPACE);
  const rootDir = resolve(ROOT);
  const repoRoot = resolve(rootDir, '../..');
  if (basename(rootDir) === 'travel-passport' && basename(dirname(rootDir)) === 'plugins'
    && existsSync(join(repoRoot, 'package-runtime-files.json'))) {
    return repoRoot;
  }
  return ROOT;
}
export const WORKSPACE_ROOT = defaultWorkspaceRoot();
export const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
