<p align="center"><img src="assets/branding/journey-atlas-logo.png" alt="Journey Atlas logo" width="132" /></p>

<p align="center"><strong>English</strong> | <a href="./README.md">中文</a></p>

<h1 align="center">Journey Atlas</h1>

<p align="center"><strong>Turn your travel records into maps and a visual passport.</strong></p>

Journey Atlas is a local-first travel visualization application and OPL MiniApp. It turns places, journeys, and directed movements into PNG/SVG passports, an interactive offline map, and Agent-readable shared views. The stable Package ID is `travel-passport`; the product and public repository are **Journey Atlas**.

## Install

Find **Journey Atlas** in the OPL software center to install, update, or uninstall the official Package. Its published source is `ghcr.io/gaofeng21cn/one-person-lab-packages/travel-passport:latest-stable`. The native carrier owns version selection; removing software preserves the private workspace, Obsidian source, exports, backups, and receipts.

```sh
node <installation>/journey-atlas.mjs version
node <installation>/journey-atlas.mjs --workspace <private-workspace> init
node <installation>/journey-atlas.mjs --workspace <private-workspace> import --input <records.json>
node <installation>/journey-atlas.mjs --workspace <private-workspace> status --json
node <installation>/journey-atlas.mjs --workspace <private-workspace> site build
```

The first CLI invocation installs locked dependencies with `npm ci --ignore-scripts`. Shared views remain read-only and offer an explicit setup action when dependencies are missing. PNG export uses an existing Chrome or Playwright Chromium installation. See [installation and shared services](docs/安装与共享基座.md).

## Source quick start

Requires Node.js 22 or newer.

```sh
npm ci
npx playwright install chromium
npm run init:data -- --source data/source
npm run import:data -- --input examples/import-bundle.json
npm run check:data
npm run build
npm run site:build
npm run site:check
npm test
npm run package:check
```

The example is fictional. Replace it with your records before importing into a personal library. Agent imports use the versioned bundle in `examples/import-bundle.json` and the [maintenance workflow](docs/维护流程.md), preserve evidence references, and validate the resulting source and outputs.

Existing tables can be bound through `dataSource.files`, `referenceRoots`, and the optional Obsidian `tableDirectory`. Source records stay in the configured location; there is no second editable travel database. See [input conventions](docs/输入目录约定.md).

## Data and outputs

Places own durable identity, journeys own activity windows, and movements own directed endpoints, transport, distance, duration, and evidence. Explicit node IDs and segment order preserve continuity. Observed, archived, reference, modeled, and unknown values retain their separate provenance.

- `npm run build` exports passports, SVGs, derived tables, and a build manifest.
- `npm run site:build` creates an offline map with global, regional, country, administrative, and city views.
- `npm run annual -- --year 2026` creates an annual card when that year's data is available.
- `npm run status -- --json` reads freshness and quality status.
- `npm run verify` checks source, data, continuity, and offline outputs.

The shared refs `travel.passport.v1#status`, `#overview`, `#annual`, and `#regions` read the same workspace as the CLI and map. Maps and images are derived outputs, not source records.

## Privacy and license

Personal routes, photos, GPS, tickets, text, and Obsidian paths stay in the user's workspace. Do not commit `inputs/`, `private/`, `outputs/`, personal configuration, or runtime caches. Report issues with fictional or redacted inputs.

Code is MIT-licensed. Bundled and optional map data retain the sources and attribution in [NOTICE.md](NOTICE.md). Optional city boundaries and roads are downloaded locally under their respective licenses.
