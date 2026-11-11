import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const WORKSPACE_ROOT = process.env.JOURNEY_ATLAS_WORKSPACE ? resolve(process.env.JOURNEY_ATLAS_WORKSPACE) : ROOT;
export const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
