# DSH Go V4 Architecture Hardening — Implementation Status

This file tracks the implementation of `dsh-go-v4-architecture-hardening-and-runtime-supervisor-plan.md` on PR #137.

## Implemented

- [x] Package Protocol V2 remains the only package identity/range/channel contract.
- [x] Manifest V2 (`dsh-package.json`) is canonical; package release no longer accepts Manifest V1 migration.
- [x] Registry V4 remains the only remote installation authority.
- [x] Candidate / Quarantine staging separates discovery from install authority.
- [x] Search Index V3 can expose non-installable discovery-only candidates.
- [x] Resolver V2 remains the shared deterministic resolution authority.
- [x] Runtime Supervisor serializes local mutations and requires explicit approval.
- [x] Policy Engine centralizes trust/permission/advisory/compatibility/approval decisions.
- [x] Artifact CAS provides immutable content snapshots and restore materialization.
- [x] Runtime State V4 records CAS/trust/policy/supply-chain/adapter/activation metadata.
- [x] Transaction Engine V2 performs one dependency-graph state publish with durable journal recovery.
- [x] Trust Root records publisher verification, signer revocation, accepted issuers and canonical revision.
- [x] Environment Lock V2 binds CAS digest, Registry revision, resolution hash, trust/policy and adapter snapshots.
- [x] Runtime Adapter ABI v1 separates Plugin/MCP/Skill/Agent execution behavior.
- [x] Activation Manager tracks candidate/active/LKG generations and bounded activation failures.
- [x] Last-Known-Good package rollback path is integrated into activation recovery.
- [x] Config layering and secret references are separated from secret values.
- [x] Local Host API V2 sends package/config/secret mutations through Runtime Supervisor.
- [x] Canonical CLI mutations send package/runtime/environment changes through Runtime Supervisor.
- [x] Desktop Marketplace package migrated to Manifest V2 and Local Host/API V2 contracts.
- [x] Append-only redacted audit event log implemented.
- [x] Architecture Conformance Gate implemented and wired into CI/release gates.
- [x] Deployment Gate V4 validates Registry V4 / Distribution V2 / Search V3 / discovery / OpenAPI convergence.
- [x] Cloudflare Pages deployment upgraded to V4 gates.
- [x] GitHub Pages deployment upgraded to V4 gates.
- [x] Tencent EdgeOne deployment upgraded to V4 gates.
- [x] Production monitor upgraded to API V2 + exact Registry V4 convergence.
- [x] Sync workflow upgraded to authoritative Sync V4 with private candidate diagnostics.
- [x] Package release upgraded to Manifest V2, reproducible archive, attestation and Registry V4 refresh.
- [x] Runtime V3 implementation tree removed.
- [x] duplicate Runtime resolver / solver / package-manager / manifest validator removed.
- [x] Registry V3 builder/pipeline/deploy gate, Sync V3 and Search Index V2 builder removed.
- [x] API V1 and legacy detail/public compatibility surfaces removed by the breaking refactor.

## Acceptance still controls merge/release

Implementation is not equivalent to release acceptance. The exact PR head must remain unmerged until the following are green on that same revision:

- [ ] Dependency Security
- [ ] CI: Breaking Contract
- [ ] CI: Architecture Conformance
- [ ] CI: Typecheck + lint
- [ ] CI: architecture/runtime/deployment tests
- [ ] CI: Astro check + build
- [ ] CI: Registry V4 generated artifact gate
- [ ] CI: Deployment Gate V4
- [ ] Runtime Platform V4 — Linux
- [ ] Runtime Platform V4 — macOS
- [ ] Runtime Platform V4 — Windows
- [ ] Final Acceptance E2E — Linux
- [ ] Final Acceptance E2E — macOS
- [ ] Final Acceptance E2E — Windows
- [ ] npm pack dry-run

After merge/release, production acceptance additionally requires exact SHA + Registry V4 convergence on Cloudflare Pages, GitHub Pages, and the configured EdgeOne production target.

Any failing item must be fixed in V4 code/tests/workflows. The solution must not restore a V1/V2/V3 compatibility surface merely to make an old test pass.
