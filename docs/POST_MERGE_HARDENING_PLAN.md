# DSH Go Post-Merge Hardening Plan

Baseline: `main` after PR #26 (`feat: productionize DSH ecosystem runtime and marketplace`) and the subsequent Registry V3 full sync.

## Goals

Keep Registry V3 as the canonical catalog while making the packaged CLI, local Runtime Registry, startup loader, and Marketplace deep-link flow reliable in real installations. The hardening work must preserve these invariants:

- installs are pinned to immutable Git commits;
- dangerous or unknown permissions require explicit local approval;
- install/update never restarts the client automatically;
- activation happens through the startup loader after a manual restart;
- Plugin / MCP / Skill / Agent share one Runtime Registry and lifecycle model;
- remote web surfaces never mutate the local runtime without a local confirmation boundary.

## P0 hardening implemented

### 1. Packaged CLI Registry availability

The npm package intentionally does not ship the multi-megabyte generated `catalog/registry-v3.json`. Runtime Registry loading therefore resolves the configured source and uses the local cache. If the repository-local catalog is absent, the default public Registry URL is used. A previously validated cache can be used when the network is temporarily unavailable.

Result: `dsh ... install`, `resolve`, preflight, and other Registry-backed commands work both from a source checkout and from an installed package.

### 2. Runtime Registry metadata integrity

The immutable `.dsh-install.json` lock is authoritative for package identity and install-time metadata. Runtime Registry reads/writes hydrate matching records from that lock, including:

- capabilities and dependencies;
- permissions and compatibility;
- publisher and security evidence;
- conflicts / replaces / provides;
- type-specific configuration.

Result: upgrades calculate permission changes from the real installed package, conflict/provider resolution sees the real installed capabilities, and rollback records cannot retain metadata from the replaced version.

### 3. Startup activation recovery

A startup activation failure with `restart_required=true` is retryable. The lifecycle now permits `failed -> verifying -> active`, allowing a package to recover after the host/client environment is corrected without forcing a reinstall.

### 4. Marketplace V2 deep-link compatibility

The official host bridge accepts both the Phase 7 URI forms and Marketplace V2 links such as:

`dsh://install?id=<id>&version=<version>&type=<type>`

Registry URLs embedded in browser links must use HTTPS, except localhost HTTP for local development, and credentials/fragments are rejected.

### 5. Local confirmation on protocol activation

Browser protocol registration no longer routes an install request into a non-interactive process that only prints a confirmation plan. Windows uses a local PowerShell confirmation dialog; Linux uses a terminal confirmation wrapper. Both invoke the official `dsh host handle ... --yes` path only after local approval. macOS remains delegated to the desktop bundle URL-scheme integration.

## Validation gates

The Runtime Platform PR gate must cover:

- Registry fallback and offline cache behavior;
- Runtime Registry lock hydration;
- retry of startup activation failures;
- Marketplace V2 URI parsing and Registry routing;
- interactive protocol registration contracts;
- the existing full Runtime Platform, Phase 7, Phase 8, Ecosystem and cross-platform suites.

## Next architecture priorities

These items are intentionally separated from the P0 repair because they change storage/distribution architecture rather than fix the merged production path:

1. **Runtime Registry concurrency control** — add a cross-process lock or journaled transaction layer so two local installers cannot lose updates during concurrent read/modify/write operations.
2. **Cryptographic release verification** — move from surfacing provenance/signature/SBOM references to actual verification (for example Sigstore/TUF-style trust roots) before activation.
3. **Registry distribution scaling** — split the 10k+ package catalog into a compact runtime index plus on-demand package metadata shards; keep the full snapshot for static export and audit.
4. **Bridge consolidation** — converge `host-bridge.mjs` and `client-bridge.mjs` onto one canonical parser/registration contract after compatibility migration is complete.
5. **Operational diagnostics** — extend `dsh doctor` with cache age, Registry source, lock/record drift, startup activation failures, and protocol-handler registration state.
6. **Release governance** — protect `main` with required CI checks and keep automated Registry sync/deploy commits constrained to generated data paths.

## Completion criteria for this hardening pass

- all new regression tests pass;
- all existing CI suites stay green on Linux, Windows and macOS;
- the follow-up hardening PR merges into `main`;
- the final `main` commit contains the latest generated Registry data rather than replacing it with an older PR snapshot.
