# DSH Go 0.1.0 — Development and Completion Plan

## Immutable public compatibility constraints

These constraints are release policy, not temporary implementation details:

1. **Public product / CLI version stays `0.1.0`.**
2. **Local Runtime compatibility version stays `0.1.0`.**
3. **New ecosystem packages default to `0.1.0`.**
4. **Canonical remote HTTP routes stay under `/api/v1/...`.**
5. **Remote MCP stays `/api/v1/mcp`.**
6. Internal names such as **Registry V3**, Registry schema `3.0.0`, package manifest schema `1.0.0`, Search Index V2, or historical source directories do **not** change the public product version or API route.
7. Install/update/repair/rollback/enable/disable/remove never automatically restart the client.
8. Public Pages/MCP surfaces remain read-only; machine mutation is local-only and authenticated.

`npm run contract:check` and CI enforce the version and route boundary.

## Target architecture

```text
GitHub repositories
      │
      ▼
Registry V3 canonical snapshot
      │
      ├── /api/v1/* read-only discovery
      ├── Marketplace pages
      └── dsh:// deep links
             │
             ▼
       Local DSH 0.1.0
             │
       preflight / approval
             │
             ▼
      Runtime Registry packages[]
             │
             ├── Plugin lifecycle
             ├── MCP execution
             ├── Skill execution
             ├── Agent lifecycle
             ├── Config + Secret Store
             └── Profile / Bundle transactions
```

## Workstream A — Public contract consolidation — IMPLEMENTED

- Product package and site package return to `0.1.0`.
- Runtime public compatibility returns to `0.1.0`.
- API metadata and remote MCP report `0.1.0` / `v1`.
- Accidental public `/api/v2/search` is removed.
- Unified ecosystem search is implemented on `/api/v1/search`.
- Existing ecosystem detail/API routes remain stable and use `?type=` for `(type,id)` disambiguation.
- Same-id Plugin/MCP/Skill/Agent entries no longer silently collide.
- Typed install commands/deep links are generated from the existing v1 surfaces.

## Workstream B — CLI and Runtime convergence — IMPLEMENTED

The public entry remains `bin/dsh.mjs`. Internal legacy adapters stay for backward compatibility, but product commands route to a shared typed runtime model.

Implemented command groups:

- lifecycle: install/list/status/update/remove/rollback/doctor/repair/enable/disable/history;
- developer: package init/validate/audit/sbom/publish-check;
- MCP execution: start/stop/restart/process-status/logs/probe/invoke;
- Skill execution: load/unload/inspect/invoke;
- config: get/set/unset for package types;
- local secrets: set/get/list/delete;
- Profile apply / Bundle install;
- transaction recovery.

Legacy plugin command names remain compatible.

## Workstream C — Local execution plane — IMPLEMENTED

### MCP

- stdio process lifecycle;
- JSON-RPC initialize + tools/call invocation;
- remote HTTP/SSE-compatible JSON response handling;
- process status and logs;
- probe;
- timeout/cancellation;
- execution only after Startup Loader activation.

### Skill

- load/unload/inspect;
- Node and explicitly configured Python executors;
- JSON stdin and JSON/text stdout;
- package-root entrypoint containment;
- timeout/cancellation;
- execution only after activation.

### Security rules

Execution is fail-closed:

- process execution requires `process.spawn`;
- remote MCP requires `network` or `network.unrestricted`;
- secret references require `secrets.read`;
- optional `permission_policy` narrows executable/host/secret resources;
- a scoped policy never grants a permission that the package did not declare.

## Workstream D — Local configuration and secret management — IMPLEMENTED

Configuration:

```text
~/.dsh/config/<type>/<id>.json
```

Secrets:

```text
~/.dsh/secrets/master.key
~/.dsh/secrets/secrets.json.enc
```

- package config uses atomic writes;
- dotted config paths reject prototype-pollution keys;
- secret references use `{ "$secret": "name" }`;
- secrets are AES-256-GCM encrypted at rest;
- local HTTP API never returns secret values;
- CLI requires explicit `--show` to display a secret locally.

The encrypted file store is the portable baseline. OS-native Keychain/Credential Manager/libsecret integration can be added later as an adapter without changing public commands, version, or API routes.

## Workstream E — Dependency safety and transaction manager — IMPLEMENTED

### Runtime Registry

- atomic temp + rename writes;
- local registry lock;
- stale-lock recovery;
- generation compare-and-swap;
- stale writes fail instead of silently losing another process's changes.

### Safe removal

- reverse dependency discovery;
- removing a required package fails with `DSH_PACKAGE_IN_USE`;
- `--cascade` explicitly removes dependents first.

### Profiles / Bundles

Execution is transactional:

1. load declarative file;
2. resolve all roots and complete dependency graph;
3. reject compatibility/conflict/permission issues before mutation;
4. stage every package and verify immutable Git commits;
5. verify Runtime Registry generation;
6. switch all package directories;
7. write Runtime Registry once;
8. preserve rollback copies;
9. recover unfinished transactions during the next Startup Loader run.

## Workstream F — Local control plane v1 — IMPLEMENTED

The local Client Host stays loopback-only and uses bearer authentication.

Existing local protocol version remains `/v1` and includes:

- install plan / execute;
- package list/get/lifecycle/delete;
- package config get/update;
- MCP execution/logs;
- Skill execution;
- secret name list/set/delete, without HTTP secret-value reads.

Mutations require explicit `approved: true`. Browser origins are allow-listed.

This is a **local** API and does not weaken the remote read-only `/api/v1` boundary.

## Workstream G — Supply-chain evidence — IMPLEMENTED WITH EXPLICIT VERIFICATION BOUNDARY

Marketplace and package tools distinguish three concepts:

1. **declared** — a manifest contains a provenance/signature/SBOM reference;
2. **digest verified** — DSH actually read evidence bytes and matched a declared SHA-256;
3. **cryptographically verified signer** — requires an authorized external signer/verifier and is not fabricated by this repository.

`npm run package:verify` verifies local evidence digests. `--online` explicitly enables remote HTTPS evidence fetching with localhost/private-IP rejection, redirect revalidation, size limits and SHA-256 matching.

A signature bundle whose bytes match a digest is still not reported as a verified signer identity unless a real signature verification integration exists.

## Workstream H — Marketplace and remote API v1 — IMPLEMENTED

- Plugin/MCP/Skill/Agent discovery remains Registry-backed.
- `/api/v1/search` supports unified type-aware browse/search.
- `/api/v1/ecosystem/:id?type=...` preserves the route while resolving type identity.
- detail pages preserve `/ecosystem/:id?type=...`.
- typed install commands and `dsh://` links remain local-execution plans.
- supply-chain UI shows evidence signals rather than a second ad-hoc trust score.

## Workstream I — Quality gates — IMPLEMENTED

New completion tests cover:

- stable `0.1.0` / API v1 contract;
- Config and encrypted Secret Store;
- reverse dependency remove guard;
- Runtime Registry CAS;
- real stdio MCP JSON-RPC invocation;
- real Skill process execution and permission denial;
- Profile transaction dry-run and dependency ordering;
- authenticated local Client Host v1;
- unified Runtime MCP tools;
- supply-chain evidence digest verification.

Runtime CI runs these tests on Linux, Windows and macOS in addition to all previous compatibility suites.

## Remaining external integration boundaries

The following items cannot honestly be completed by repository-only code without external assets/credentials. They do **not** require a new product version or API route when added:

- real DeepSeek Harness desktop bundle source integration on all three operating systems;
- OS-native keychain adapter tests against signed production desktop packages;
- publisher-owned Sigstore/Cosign/OIDC signing credentials and identity policy;
- npm registry publication credentials if the CLI is to be published to npm;
- production secrets/permissions needed for release signing and external mirror publication.

Until those dependencies are supplied, DSH must expose their state as unavailable/unverified rather than simulate success.

## Release acceptance gate

A source change is ready for review only after:

```text
0.1.0 contract check
→ typecheck
→ lint
→ completion tests
→ legacy/runtime/production compatibility tests
→ full tests
→ site check/build
→ Registry gate
→ npm pack dry-run
→ Linux + Windows + macOS Runtime matrix
```

Final feature branches should be rebased/rebuilt on the latest generated Registry snapshot and submitted as one clean commit.
