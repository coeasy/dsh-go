# Ecosystem Platform V1

Ecosystem Platform V1 completes the layer above Runtime Platform V2. Registry V3 remains the canonical catalog; Runtime Platform V2 remains the only component that performs local installation and mutation.

## Architecture

`Registry V3 -> Marketplace contracts -> Trust/Search -> Pages Ecosystem API / read-only MCP -> local Runtime plan -> MCP / Skill / Agent bindings -> Profile/Bundle plans -> Runtime Platform V2 -> client restart loader -> active`

The public marketplace and remote MCP surfaces never claim to mutate a user's machine. They may resolve catalog entries and return deterministic local-runtime plans. Filesystem, install, update, rollback, enable/disable, and repair remain local-only operations.

## Marketplace and public API

Marketplace V1 maps Registry V3 records into a shared `plugin | mcp | skill | agent` item model, supports case-insensitive search by id/name/description, type/channel/capability filters, deterministic version enumeration, immutable-source validation, and an explainable supply-chain score.

`GET /api/v1/ecosystem` exposes the Registry V3 ecosystem with `type`, `capability`, `verified`, `search`, and pagination filters. `GET /api/v1/ecosystem/:id` returns one resolved item, its pinned commit, and a local install plan. The existing `/api/v1/plugins` endpoints remain backward-compatible with the legacy marketplace view.

Calling the marketplace install adapter without an explicitly bound local executor returns a plan with `executed: false` and `requiresLocalRuntime: true`; it no longer returns fake installation success. UI state follows the same contract: plan -> local execution -> restart-required -> active.

## MCP

The remote Pages MCP endpoint remains read-only. It adds `list_ecosystem`, `get_ecosystem_item`, and `plan_local_install`; the last tool only returns a local `dsh plugin install ...` command and never executes it. Network and filesystem permissions in the local MCP runtime are denied unless granted. Runtime binding becomes active only through an explicitly local caller.

## Skills

Skills resolve dependencies in dependency-first order with missing-dependency and cycle detection. Execution only uses registered executors; unknown executors fail explicitly. Lifecycle transitions are validated instead of accepting arbitrary state changes.

## Agents

Agents build deterministic capability graphs, route tools only through an explicit tool registry, and execute workflows sequentially. A missing tool stops the workflow and returns the completed step history plus the error.

## Profiles and bundles

Profiles/bundles select multiple marketplace items with exact or latest versions, optional channels, optional items, duplicate/conflict detection, and deterministic local Runtime install plans. Dependency installation remains delegated to Runtime Platform V2 so there is one dependency engine rather than two competing implementations.

## Client restart activation

Install/update/repair/rollback/enable/disable continue to set `restart_required` and never restart the client. On the next client startup, `loadInstalledPlugin()` verifies the install lock and immutable Git commit, then persists the registry transition to `active`, sets `activated: true`, and clears `restart_required`. Disabled or removed packages are rejected before activation. This closes the install -> restart -> load -> active lifecycle without forcing a client restart from the installer.

## Runtime V3 compatibility layer

The historical TypeScript files under `runtime/v3` are retained as compatibility contracts, but fake side effects are removed. Installer, updater, downloader, extractor, and remove helpers now return local Runtime plans; checksum verification fails closed when expected integrity is absent. The runnable implementation remains `runtime/*.mjs`. The entire TypeScript ecosystem source tree is included in the root strict typecheck to prevent these compatibility contracts from drifting again.

## Verification

`npm run ecosystem:test` covers Registry V3 API mapping, marketplace trust/search/plans/UI state, MCP discovery/permissions/binding, skill dependency resolution/execution, agent workflow routing, and Profile/Bundle resolution. Runtime Platform tests cover restart activation persistence with a real local Git fixture. `Ecosystem Platform V1` CI also runs root typecheck, full lint, all regression tests, and the Registry V3 compatibility gate.
