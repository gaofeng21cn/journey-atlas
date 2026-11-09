import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
