# Ecosystem Platform V1

Ecosystem Platform V1 is the layer above the local Runtime Platform. Registry V3 remains the canonical catalog; Runtime Platform V3 is the canonical local mutation/runtime layer. Runtime Platform V2 and Phase 7 plugin entry points remain compatibility surfaces over the V3 package model.

## Architecture

`Registry V3 -> Marketplace contracts -> Trust/Search -> Pages Ecosystem API / read-only MCP -> local Runtime plan -> plugin / MCP / Skill / Agent package resolution -> Profile/Bundle plans -> Runtime Platform V3 -> explicit client restart loader -> local bindings -> active`

The public marketplace and remote MCP surfaces never claim to mutate a user's machine. They may resolve catalog entries and return deterministic local-runtime plans. Filesystem, install, update, rollback, enable/disable, repair, binding, and activation remain local-only operations.

## Marketplace and public API

Marketplace V1 maps Registry V3 records into a shared `plugin | mcp | skill | agent` item model, supports case-insensitive search by id/name/description, type/channel/capability filters, deterministic version enumeration, immutable-source validation, and an explainable supply-chain score.

`GET /api/v1/ecosystem` exposes the Registry V3 ecosystem with `type`, `capability`, `verified`, `search`, and pagination filters. `GET /api/v1/ecosystem/:id` returns one resolved item, its pinned commit, and a local install plan. The existing `/api/v1/plugins` endpoints remain backward-compatible with the legacy marketplace view.

Calling the marketplace install adapter without an explicitly bound local executor returns a plan with `executed: false` and `requiresLocalRuntime: true`; it never returns fake installation success. UI state follows the same contract: plan -> local execution -> restart-required -> startup verification/binding -> active.

## MCP

The remote Pages MCP endpoint remains read-only. It exposes ecosystem discovery and local-install planning only. Local MCP packages are installed and bound by Runtime Platform V3; network/filesystem/process permissions are denied unless explicitly granted. Runtime binding becomes active only through the explicit local startup loader.

## Skills

Skills resolve dependencies in dependency-first order with missing-dependency and cycle detection. Runtime Platform V3 treats a skill as a first-class package, recognizes `SKILL.md` / `skill.md`, and persists its local binding after immutable-source verification. Execution remains delegated to an explicitly registered executor.

## Agents

Agents build deterministic capability graphs, route tools only through an explicit tool registry, and execute workflows sequentially. Runtime Platform V3 treats agent packages as typed local packages and records agent workflow metadata in the binding descriptor without executing it during installation or startup discovery.

## Profiles and bundles

Profiles/bundles select multiple marketplace items with exact or latest versions, optional channels, optional items, duplicate/conflict detection, and deterministic local Runtime install plans. Dependency installation remains delegated to Runtime Platform V3 so there is one dependency engine rather than competing per-type installers.

## Client restart activation

Install/update/repair/rollback/enable/disable continue to set `restart_required` and never restart the client. On the next client startup, the V3 loader verifies the schema-3 install lock and immutable Git commit, discovers a type-specific manifest, creates a fail-closed local binding, persists the registry transition to `active`, sets `activated: true`, and clears `restart_required`. Disabled or removed packages are rejected before activation. One failed package does not prevent other packages from activating.

## Runtime Platform V3

The runnable implementation remains `runtime/*.mjs`. Runtime Registry schema 3 stores canonical `packages[]` keyed by `(type,id)` and emits a generated plugin mirror for compatibility. Schema 1/2 plugin registries and Phase 7 install locks migrate automatically as `type=plugin`.

The TypeScript files under `runtime/v3` are retained as strict compatibility contracts and now use the same typed package identity, schema-3 storage, local-runtime planning, and binding semantics. Plugin-named functions remain compatibility aliases where existing callers need them; package-generic APIs are canonical.

See `docs/PHASE_8_RUNTIME_PLATFORM_V3.md` for the local runtime contract, storage layout, CLI, URI protocol, migration, security model, and verification matrix.

## Verification

`npm run ecosystem:test` covers Registry V3 API mapping, marketplace trust/search/plans/UI state, MCP discovery/permissions/binding, skill dependency resolution/execution, agent workflow routing, and Profile/Bundle resolution. `npm run phase8:test` covers the unified local package model, schema migration, cross-type dependency resolution, real Git installation, startup binding/activation, Host Bridge, and CLI compatibility. Dedicated Runtime V3 CI runs this suite plus strict TypeScript and ESLint on Linux, Windows, and macOS.
