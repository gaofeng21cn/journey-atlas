import {readAtlasConfig} from './source-data.mjs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readJson, ROOT } from './data.mjs';
import { renderAtlas } from './render-atlas.mjs';
import {writeOutputGuide} from './output-paths.mjs';

const { values } = parseArgs({ options: {
  vault: { type: 'string' },
  output: { type: 'string' },
  variant: { type: 'string', default: 'all' },
  scope: { type: 'string', default: 'all' },
} });

const config = await readAtlasConfig();
const output = values.output ? resolve(values.output) : config.output;
await renderAtlas({
  vault: values.vault && resolve(values.vault),
  output,
  variant: values.variant,
  scope: values.scope,
  syncVault: true,
});

// All passports, including the flight card, now share the maintained atlas.
// The old snapshot remains accessible only through the explicit legacy command.
await writeOutputGuide(output);
