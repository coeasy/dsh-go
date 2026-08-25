# Runtime Platform V2

Runtime Platform V2 turns the marketplace installer into a persistent local plugin runtime while preserving Registry V3 as the canonical catalog and keeping client activation restart-driven.

## Architecture

`Marketplace -> Registry V3 -> Resolver -> Dependency Plan -> Installer -> Runtime Registry V2 -> Health / Update / Rollback -> Client restart -> Loader`

The public Cloudflare MCP endpoint remains read-only. Mutating runtime MCP tools are explicitly local-only so a remote stateless service cannot claim to install or change a user's local plugins.

## Runtime registry

The local registry is stored under `~/.dsh/registry/runtime.json` unless `DSH_REGISTRY` is set. Schema 1 registries are migrated in memory and the next write persists schema 2. Each plugin record keeps channel, desired enablement, activation state, restart requirement, health snapshot, rollback metadata, dependencies, and a bounded lifecycle history.

Writes use a temporary file plus atomic rename. Removed plugins remain as tombstones so lifecycle history is retained; `plugin list --all` includes them.

## CLI

```bash
dsh plugin list
dsh plugin status <id>
dsh plugin install <id> [--channel stable|beta|nightly|dev]
dsh plugin update <id> [version-or-range] [--channel channel]
dsh plugin health [id]
dsh plugin doctor [id]
dsh plugin repair <id>
dsh plugin enable <id>
dsh plugin disable <id>
dsh plugin history <id>
dsh plugin rollback <id>
dsh plugin remove <id>
```

The repository implementation is invoked with `node runtime/cli.mjs plugin ...`. Install, update, repair, rollback, enable, disable, and remove set `restart_required`; they do not restart the client automatically.

## Dependency resolver

Dependencies may be strings (`plugin-id`, `plugin-id@^1.2.0`) or objects (`{ id, range, optional }`). The resolver provides dependency-first ordering, cycle detection, incompatible constraint detection, channel filtering, replacement reporting, and a small built-in SemVer range implementation supporting exact, wildcard, comparison, caret, tilde, AND, and OR expressions.

## Update and rollback

Updates install into a temporary checkout pinned to an immutable Git commit, verify the commit, move the current installation to `.backup`, then atomically switch the new checkout into place. Any install failure restores the previous backup. Explicit rollback swaps the backup back and updates Runtime Registry V2.

## Health

Health checks validate runtime metadata, plugin path, install lock, id/version consistency, pinned Git commit, manifest availability, and installed dependency presence. Results are persisted as the latest health snapshot. `failed` is reserved for critical integrity/runtime failures; missing optional metadata such as a manifest is reported as `warning`.

## MCP runtime tools

The local adapter exposes `plugin.install`, `plugin.update`, `plugin.status`, `plugin.health`, `plugin.rollback`, `plugin.enable`, `plugin.disable`, and `plugin.repair`. `runtime/mcp-tools.mjs` produces local CLI plans and executes only when a local handler is explicitly bound.

## Verification

`npm run runtime:test` runs lifecycle, registry migration, SemVer/dependency graph, local MCP, CLI persistence, and a real local-Git install/update/health/rollback E2E test. The dedicated Runtime Platform GitHub Actions workflow also runs Registry V3 compatibility and ESLint gates.
