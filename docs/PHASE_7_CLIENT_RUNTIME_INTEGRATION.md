# Phase 7 — Client Runtime Integration

Phase 7 turns the existing Runtime Platform into a desktop-client integration surface without modifying DeepSeek Harness and without automatically restarting the client.

## Goals

- expose a stable `dsh` executable instead of requiring `node runtime/cli.mjs`;
- route marketplace install actions through a local `dsh://` host bridge;
- persist installs as `restart_required: true`;
- activate installed plugins only when the client explicitly invokes the startup bridge on its next launch;
- provide cross-platform protocol registration contracts;
- provide runtime/PATH diagnostics and an explicit self-update mechanism;
- validate the complete browser URI → local runtime dry-run path on Linux, Windows, and macOS CI.

## Public CLI

The root package now exposes:

```json
{
  "bin": {
    "dsh": "bin/dsh.mjs"
  }
}
```

Primary commands:

```bash
dsh plugin install <id|owner/repo>[@version]
dsh plugin list
dsh plugin status [id]
dsh plugin update <id> [version]
dsh plugin rollback <id>
dsh plugin remove <id>
dsh plugin uninstall <id>
dsh plugin doctor [id]
dsh plugin repair <id>
dsh plugin enable <id>
dsh plugin disable <id>
dsh plugin history <id>
```

`plugin install` is normalized to the existing verified Runtime installer. `plugin uninstall` is an alias of the existing remove lifecycle.

## Host Bridge protocol

Canonical install URI:

```text
dsh://plugin/install/<url-encoded-plugin-spec>
```

Example:

```text
dsh://plugin/install/ruvnet%2Fruflo%400.1.0?channel=stable
```

The existing marketplace URI remains supported:

```text
dsh://install?plugin=ruvnet%2Fruflo
```

Use:

```bash
dsh host uri ruvnet/ruflo@0.1.0 --channel stable
dsh host parse 'dsh://install?plugin=ruvnet%2Fruflo'
dsh host handle 'dsh://plugin/install/ruvnet%2Fruflo%400.1.0'
```

The bridge accepts only the `dsh:` protocol and validated plugin specs. It never accepts a registry path or executable command from the URI itself. Local-only CLI flags such as `--registry`, `--root`, and `--dry-run` must be supplied by the local caller.

## Install → restart → activation lifecycle

The lifecycle is intentionally split:

```text
Marketplace
  ↓ dsh:// URI
Local Host Bridge
  ↓
Runtime Resolver / Installer
  ↓
Runtime Registry: installed + restart_required=true
  ↓
User manually restarts the desktop client
  ↓
Desktop client runs: dsh startup activate
  ↓
Startup Loader verifies install lock + pinned Git commit
  ↓
Runtime Registry: active + activated=true + restart_required=false
```

The installer never restarts the desktop client automatically.

The startup bridge activates every pending enabled plugin independently. A failed activation is persisted as `state=failed`, keeps `restart_required=true`, records a health failure for `startup-activation`, and does not prevent the bridge from attempting the remaining plugins.

## Desktop client integration

### Windows

`dsh host registration` returns per-user `HKCU\\Software\\Classes\\dsh` registration commands. `dsh host register` can apply them through `reg.exe`.

The registered command forwards the full URI to:

```text
node <dsh.mjs> host handle "%1"
```

### Linux

`dsh host register` writes a per-user desktop entry to:

```text
~/.local/share/applications/dsh-go.desktop
```

with:

```text
MimeType=x-scheme-handler/dsh;
```

and requests the association with `xdg-mime` when available.

### macOS

macOS URL-scheme ownership must be declared by an application bundle. `dsh host registration` therefore returns the required `CFBundleURLTypes` contract. The desktop client should add the `dsh` URL scheme to `Info.plist` and forward received URLs to:

```bash
dsh host handle '<received-uri>'
```

The CLI does not create a fake macOS application bundle.

## Startup hook

Desktop clients should execute this once during normal startup, after their runtime storage is available and before plugin discovery is finalized:

```bash
dsh startup activate
```

An optional local runtime-registry path can be supplied by the embedding client:

```bash
dsh startup activate --registry /path/to/runtime.json
```

Exit code is non-zero if one or more pending plugins fail activation.

## Runtime diagnostics and update

```bash
dsh runtime info
dsh runtime check-update
dsh runtime update --dry-run
dsh runtime update
```

`runtime info` reports:

- DSH runtime version;
- Node version and Node >=20 compatibility;
- OS and architecture;
- whether a `dsh` command is discoverable on `PATH`.

`runtime check-update` reads the latest GitHub release. `runtime update` is explicit and installs the newer tagged repository package globally through npm. No silent background self-update is performed.

## Testing

Phase 7 adds focused tests for:

- canonical and legacy URI parsing;
- unsafe URI rejection;
- Windows/Linux/macOS protocol-registration contracts;
- official `dsh` help/version/host commands;
- PATH/runtime diagnostics;
- release update planning;
- browser URI → Host Bridge → Resolver → Installer dry-run E2E;
- multi-plugin startup activation;
- activation failure persistence and restart-required behavior.

`.github/workflows/phase7-client-runtime.yml` executes the Phase 7 suite, TypeScript, and ESLint on:

- `ubuntu-latest`;
- `windows-latest`;
- `macos-latest`.

## Compatibility

Phase 7 is additive. Existing commands such as:

```bash
node runtime/cli.mjs plugin ...
```

continue to work. The existing `dsh://install?plugin=...` marketplace link is also retained, so the client bridge can ship before Marketplace V2 changes the UI to the canonical URI form.
