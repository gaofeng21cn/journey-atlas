import {readAtlasConfig} from './source-data.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT, readJson } from './data.mjs';
import { prepareSiteData } from './site-data.mjs';
import { createScopeEngine } from '../src/scope-model.mjs';
import { gatewayIdentity } from '../src/city-gateways.mjs';
import { isRecordedMovement } from '../src/route-semantics.mjs';

// Read-only audit for the display projection. It never promotes a place or
// edits a route; it makes unresolved page-edge identities fail before export.
const { values } = parseArgs({ options: { output: { type: 'string' }, vault: { type: 'string' } } });
const config = await readAtlasConfig();
const output = resolve(values.output || join(config.output, 'checks'));
const data = await prepareSiteData({ vault: values.vault });
const engine = createScopeEngine(data);
const identities = new Map(), unknown = [];
let scannedScopes = 0, scannedRoutes = 0;

for (const scope of data.scopes) {
  const view = engine.query(scope.id);
  if (!view.routes.length || !engine.isVisible(scope.id)) continue;
  scannedScopes++;
  for (const route of view.routes.filter(isRecordedMovement)) {
    const nodes = route.nodes || [];
    if (nodes.length < 2) continue;
    const inside = nodes.map(node => engine.contains(scope, node));
    if (inside.every(Boolean) || inside.every(v => !v)) continue;
    scannedRoutes++;
    for (const [index, node] of nodes.entries()) {
      if (inside[index]) continue;
      const identity = gatewayIdentity(node, { scope, catalog: data.gatewayCatalog });
      const key = `${scope.id}|${identity.key}`;
      const row = identities.get(key) || { scope: scope.id, scopeName: scope.name, ...identity, routes: [], endpoints: [] };
      if (!row.routes.includes(route.id)) row.routes.push(route.id);
      const endpoint = `${node.name || ''}|${node.country || ''}|${node.lat},${node.lon}`;
      if (!row.endpoints.includes(endpoint)) row.endpoints.push(endpoint);
      identities.set(key, row);
      if (identity.kind === 'unknown') unknown.push({ scope: scope.id, scopeName: scope.name, route: route.id, ...node, ...identity });
    }
  }
}

const rows = [...identities.values()].sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name, 'zh-CN'));
const report = {
  generatedAt: new Date().toISOString(),
  summary: { scopes: scannedScopes, routes: scannedRoutes, identities: rows.length, unknown: unknown.length,
    bySource: Object.fromEntries([...rows.reduce((m, row) => m.set(row.source, (m.get(row.source) || 0) + 1), new Map())]) },
  identities: rows,
  unknown,
};
await mkdir(output, { recursive: true });
await writeFile(join(output, '外部城市边缘节点审计.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report.summary, output: join(output, '外部城市边缘节点审计.json') }, null, 2));
if (unknown.length) {
  console.error('存在未核定外部城市边缘节点：' + unknown.map(n => `${n.scopeName}/${n.route}/${n.lat},${n.lon}`).join('；'));
  process.exitCode = 1;
}
