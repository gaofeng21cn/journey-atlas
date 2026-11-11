---
name: travel-planning
description: Import user-owned travel records into Journey Atlas and review, update, or generate travel passports from the configured local source, maps, and build evidence.
---

# Journey Atlas

Treat the configured source tables and private configuration as the owner of travel facts. The
interactive site and images are projections; never infer or rewrite personal travel
from generated output.

For an MCP App review, read `travel.passport.v1#status`, `#overview`, `#annual`, or `#regions` through the registered contribution refs. It returns the owner's current
build freshness, quality gate, evidence boundaries, and aggregate counts without
placing private route contents in the Package repository.
Open the shared OPL MCP App with the registered Journey Atlas `workspace_path`.
The installed carrier uses that binding only for data. All code runs from the
active installed Package, never from scripts or package.json in the workspace.
With no configured workspace, the view asks for its path. If runtime dependencies
are missing, the read stays read-only and offers the confirmed runtime setup.

For installed use, run `node <package-root>/journey-atlas.mjs --workspace <path>
<command>` with `init`, `import`, `status`, `check`, `trace`, `update`, `receipt`,
`build`, `site`, `annual`, or `verify`. `version` reads the actual installed
identity; `setup` installs locked npm dependencies without package scripts. The
first CLI business command uses the same setup automatically. `site build`
generates the interactive offline UI; `status --json` supplies Agent readback.
Package code and dependencies stay in the carrier; configuration, source tables,
outputs, backups, and receipts stay in the external workspace across updates and
uninstall. Read [installation and shared foundation](../../docs/安装与共享基座.md).

Use already authorized OPL knowledge sources first, especially Obsidian. Read a
known source through `opl knowledge read-source` and use Framework dependency
verification and action revalidation before consuming it. Bind source tables and
allowed reference roots in the private workspace configuration; do not clone the
knowledge store. No account is required for local use. Future network import must
use OPL Connect references rather than store credentials in this Package.

## First import

For a new user, read `examples/import-bundle.json`, `scripts/schema.mjs`, and
the maintenance guide. Convert only the user's supplied records and supported
reconstructions into a `version: 1` bundle. Keep raw evidence outside Git and
preserve stable record IDs, evidence references, date precision, and numerical
provenance. Read existing configuration before initializing; never import the
fictional example into an existing personal workspace.

For an explicit development checkout, run `npm ci`, `npm run init:data`, then
`npm run import:data -- --input <user-bundle.json>`. Continue through
`npm run check:data`, `npm run build`, and `npm run verify`. The CSV directory
is the default source; Obsidian is optional. New evidence updates existing IDs
through the normal preview-and-update entry instead of importing duplicates.

## Review

Run `npm run status -- --json` to inspect the current owner workspace. Run
`npm run check:data` when the status says the data structure needs attention. Read
[architecture](../../docs/架构与数据边界.md) before proposing a data change and
[maintenance](../../docs/维护流程.md) before preparing a patch.

Distinguish structural errors from managed evidence boundaries. Do not clear
`visitsAwaitingRestoration`, `managedConnectionsAwaitingRestoration`, observation
intervals, or mobility conflicts by inventing routes, promoting airport contact to a
ground visit, or substituting zero-distance links.

## Change

Preview changes with the repository's `infer-*` or `repair-*` command and use
`npm run update -- --input <patch> --dry-run` before applying a reviewed patch.
Private outputs, credentials, source photos, and personal source tables stay outside
Git. A fresh status does not replace semantic evidence review.

Use `npm run verify` only after a real build. Separate a source-level review from
browser rendering, output freshness, and visual acceptance.
