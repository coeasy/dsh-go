# Runtime Installer v1

## Scope

- Runtime Registry persistence
- Plugin install lifecycle
- CLI list/remove/update flows
- E2E validation

## Flow

Registry -> Download -> Verify -> Extract -> Install -> Persist -> Resolve


## Complete local lifecycle

The website's dsh://install link is handled by the local DSH client. The client now supports:

- dsh plugin add github:owner/repo
- dsh plugin list
- dsh plugin update <id> [version]
- dsh plugin rollback <id>
- dsh plugin remove <id>
- dsh plugin doctor

Installation resolves catalog/registry-v3.json, installs dependencies first, fetches a pinned commit, verifies the checkout, atomically replaces the target, and persists ~/.dsh/registry/runtime.json. Updates keep a .backup directory and failed replacements restore it automatically. Use --dry-run for a no-write plan and --root for an isolated test directory. DSH_RUNTIME_HOME, DSH_PLUGIN_HOME, and DSH_REGISTRY override local storage paths.
