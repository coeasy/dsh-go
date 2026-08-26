# Phase 8 — Runtime Platform V3 / Unified Package Model

Phase 8 promotes the local runtime from a plugin-only installer into one canonical runtime for `plugin`, `mcp`, `skill`, and `agent` packages. Registry V3 remains the remote catalog authority. Runtime Platform V3 remains the only component allowed to mutate the user's local runtime state.

## Invariants

1. **One local package model.** Every installed item has a canonical `(type, id)` identity. The same `id` may exist in different package types without collisions.
2. **Immutable source identity.** Installation resolves a Registry V3 record to an exact Git commit and verifies the existing Registry V3 integrity checksum before checkout.
3. **Atomic local state.** Runtime Registry schema 3 is written by temp-file + rename and stores canonical `packages[]`. A generated `plugins[]` mirror is retained only for V2/Phase 7 compatibility.
4. **No automatic client restart.** Install, update, repair, rollback, enable, disable, and remove only set `restart_required`. Activation happens on the next explicit client startup.
5. **Fail-closed local binding.** Network, filesystem, and process permissions default to denied. Runtime bindings are descriptors; Phase 8 does not execute arbitrary package code during discovery or activation.
6. **Backward compatibility.** Existing `dsh plugin ...`, top-level `dsh install ...`, `dsh://plugin/install/...`, and legacy `dsh://install?plugin=...` remain supported.

## Unified package identity

Canonical identity is `type:id`, where type is one of:

- `plugin` — DeepSeek Harness plugin source.
- `mcp` — MCP server/package binding.
- `skill` — reusable skill package, including `SKILL.md`/`skill.md` layouts.
- `agent` — agent/workflow package.

Runtime package IDs are filesystem-safe. Repository specs may use `owner/repo`. Typed specs use `type:id@version`, for example:

```text
plugin:ruflo@0.1.0
mcp:owner/server@1.2.0
skill:helper@1.0.0
agent:worker@2.0.0
```

Dependencies may use the same typed form. Untyped dependencies remain plugin dependencies for compatibility with existing Registry V3 records.

## Runtime Registry schema 3

Canonical persisted shape:

```json
{
  "schema_version": 3,
  "generation": 12,
  "updated_at": "...",
  "packages": [
    {
      "id": "demo",
      "type": "mcp",
      "version": "1.0.0",
      "state": "installed",
      "restart_required": true
    }
  ],
  "plugins": []
}
```

Schema 1 and 2 `plugins[]` registries are migrated in memory to schema 3 automatically and become `type=plugin`. Writes always produce schema 3. Duplicate `(type,id)` records are rejected while equal IDs across different types are legal. The compatibility `plugins[]` mirror is generated from canonical `packages[]` and checked for drift when present.

Default storage:

```text
~/.dsh/registry/runtime.json
~/.dsh/plugins/<id>                # legacy plugin path preserved
~/.dsh/packages/mcp/<id>
~/.dsh/packages/skill/<id>
~/.dsh/packages/agent/<id>
```

`DSH_RUNTIME_HOME`, `DSH_REGISTRY`, `DSH_PLUGIN_HOME`, and `DSH_PACKAGE_HOME` continue to support relocatable local runtimes.

## Resolution and dependency graph

Runtime Platform V3 still consumes Registry V3 `plugins[]` because that is the current catalog envelope, but package type is inferred from `runtime.type` first and capabilities second. Resolution filters by `(type,id,channel,semver)`.

Dependency planning uses canonical typed keys internally and provides:

- dependency-first deterministic installation order;
- optional dependency handling;
- cross-type cycle detection;
- cross-type version conflict detection;
- replacement detection against installed `(type,id)` records;
- plugin-compatible graph labels for existing callers.

There is still exactly one dependency engine.

## Install, update, rollback, and remove

`installPackage()` verifies the resolved Registry V3 package, checks out the exact commit into a temporary Git worktree, verifies `HEAD`, writes `.dsh-install.json`, and atomically renames the directory into place. Replacement uses one backup path and restores it on failure.

The install lock now records:

```json
{
  "registry_version": 3,
  "runtime_registry_version": 3,
  "id": "server",
  "type": "mcp",
  "package_type": "mcp",
  "version": "1.0.0",
  "source": { "provider": "github", "repo": "owner/server", "commit": "..." },
  "restart_required": true
}
```

Old locks without `type` normalize to `plugin`, so Phase 7 installations remain loadable.

## Local bindings

Activation creates a local binding descriptor after install-lock and commit verification. Discovery order is type-specific:

| Type | Manifest candidates |
| --- | --- |
| plugin | `dsh-plugin.json`, `package.json` |
| mcp | `dsh-mcp.json`, `mcp.json`, `package.json` |
| skill | `SKILL.md`, `skill.md`, `dsh-skill.json`, `package.json` |
| agent | `dsh-agent.json`, `agent.json`, `package.json` |

Bindings include package type, local target, capabilities, manifest metadata, transport=`local`, and permission flags. Missing permissions are denied by default. MCP transport config and agent workflow metadata are passed through as descriptors, not executed by the loader.

## Startup activation

`dsh startup activate` scans every package type. Candidates are installed or restart-pending enabled packages. For each package it:

1. verifies state is not removed/disabled;
2. reads and normalizes the install lock;
3. checks lock `(type,id,version)` identity;
4. verifies the pinned Git commit;
5. discovers the type-specific manifest;
6. creates a safe local binding;
7. persists `active`, `activated=true`, and `restart_required=false`.

One broken package is persisted as `failed` with `phase=startup-activation` and does not prevent other packages from activating.

## CLI

Canonical commands:

```bash
dsh package list
dsh package status
dsh package install mcp:owner/server@1.0.0
dsh mcp install owner/server@1.0.0
dsh skill install helper@1.0.0
dsh agent install worker@1.0.0
dsh plugin install owner/plugin@0.1.0
```

Every namespace supports `list`, `status`, `install`, `update`, `rollback`, `remove|uninstall`, `enable`, `disable`, `doctor|health`, `repair`, and `history`. `package` accepts typed specs and `--type` where needed. Existing top-level runtime commands remain compatible.

## Browser / desktop Host Bridge

Phase 7 plugin URLs stay canonical for plugins:

```text
dsh://plugin/install/<encoded-spec>
dsh://install?plugin=<encoded-spec>       # legacy
```

Typed packages add:

```text
dsh://package/install/mcp/<encoded-spec>
dsh://package/install/skill/<encoded-spec>
dsh://package/install/agent/<encoded-spec>
```

Convenience `dsh://mcp/install/...`, `dsh://skill/install/...`, and `dsh://agent/install/...` forms are accepted. All URI input is type/spec/channel validated before conversion to CLI arguments; no URI text is passed to a shell.

## TypeScript V3 contracts

The historical `runtime/v3/**/*.ts` compatibility layer is updated to schema 3 and typed package identity. Plugin-named exports remain aliases where required, but package-generic APIs are canonical. TypeScript CI keeps these contracts from drifting away from the runnable `.mjs` runtime.

## Verification

Phase 8 adds dedicated tests for:

- typed package parsing and unsafe-input rejection;
- schema 1/2 -> schema 3 migration and plugin mirror compatibility;
- equal IDs across different package types;
- mixed plugin/MCP/skill/agent dependency graphs and cycles;
- real local Git installation for all four package types;
- install-lock V3 identity and immutable commit verification;
- safe local binding and default-deny permissions;
- multi-type startup activation and failure isolation;
- unified CLI dry-run/list behavior;
- legacy + typed Host Bridge protocols.

`.github/workflows/phase8-runtime-v3.yml` runs the Phase 8 suite, TypeScript, and ESLint on Ubuntu, Windows, and macOS. Existing Runtime Platform, Ecosystem, and full regression workflows remain authoritative compatibility gates.
