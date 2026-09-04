# DSH Go V4 Hardened Runtime Architecture

> This document is the implementation architecture that hardens the existing public V4 contracts without introducing Protocol V3, Registry V5, or Runtime State V5. Package Protocol V2, Manifest V2, Registry V4, API V2, Resolver V2, and Runtime State V4 remain the only public contracts.

## 1. Final authority model

DSH Go now uses a strict authority split:

```text
Remote discovery sources
        ↓
Candidate Collector
        ↓
Normalize / Manifest V2 validation / immutable commit resolution
        ↓
Candidate Quarantine
        ↓ accepted only
Registry V4 ──────────────── read authority
   ├─ Distribution V2
   ├─ Search Index V3 (+ discovery-only candidates)
   ├─ Edge API V2
   ├─ MCP Tools V2
   └─ Marketplace V2
        ↓ Package Protocol V2 request
Resolver V2
        ↓ deterministic Resolution Plan V2
Local explicit approval
        ↓
Runtime Supervisor ───────── only mutation authority
   ├─ Policy Engine
   ├─ Transaction Engine V2
   ├─ Artifact CAS
   ├─ Runtime State V4
   ├─ Environment Lock V2
   ├─ Secret / Config stores
   ├─ Audit log
   └─ Activation Manager
        ↓
Runtime Adapter ABI
   ├─ Plugin
   ├─ MCP
   ├─ Skill
   └─ Agent
        ↓
health check / Last-Known-Good recovery
```

The web Marketplace, Edge API, MCP endpoint, Deep Link, and desktop Marketplace UI are not installation authorities. They can discover packages or request plans. Local mutation is always mediated by Runtime Supervisor and explicit approval.

## 2. Runtime Supervisor

`runtime/supervisor.mjs` is the single-writer coordination boundary for package/runtime/config/secret/environment mutations.

Responsibilities:

- serialize mutation commands across CLI, Local Host API and desktop clients;
- require explicit approval for mutation operations;
- assign request and operation identities;
- record generation before/after mutation;
- emit append-only audit events;
- preserve Runtime State V4 generation-CAS as the final storage safety barrier.

CLI and desktop clients must not write Runtime State directly.

## 3. Policy Engine

`packages/policy-core` is the single policy decision contract.

Inputs include:

- package identity and exact release;
- operation type;
- publisher identity;
- requested permissions;
- compatibility result;
- release/signature/provenance verification;
- Registry trust context;
- package-scoped advisories;
- local approval state.

Outputs are exactly:

```text
allow
require-confirmation
deny
```

Fail-closed conditions include revoked releases/signers, applicable critical advisories, yanked releases for load operations, failed compatibility, and a required signature that has not been cryptographically verified.

Popularity and stars are never trust inputs.

## 4. Artifact CAS

The canonical content-addressable directory store is:

```text
~/.dsh/store/sha256/<digest>
```

Install sequence:

```text
download/fetch
→ temporary extraction
→ immutable source/artifact verification
→ supply-chain verification
→ Policy Engine
→ CAS snapshot
→ verify CAS digest
→ materialize from CAS
→ write local .dsh-install.json metadata
→ atomic package switch
```

`.dsh-install.json` is mutable local installation metadata and is intentionally excluded from the immutable content digest. Environment restore and rollback can materialize verified content from CAS rather than trusting a mutable installation directory.

## 5. Trust Root

Local trust state lives under:

```text
~/.dsh/trust/trust-root.json
```

Trust Root records publisher verification, accepted issuers and revoked signer identities and has its own canonical SHA-256 revision.

A release trust snapshot records the trust root revision used at decision time. A package is `trusted` only when verified publisher ownership and cryptographic signature verification both succeed and the signer is not revoked. Declared signatures, SBOM references, provenance references, repository stars, or a digest by themselves never create Trusted status.

Environment restore re-evaluates signer revocation against the current trust root before materialization.

## 6. Activation Manager and Last-Known-Good

Install/update/rollback and activation are separate transactions.

Runtime State V4 carries activation-generation metadata:

```text
active_generation
candidate_generation
last_known_good_generation
last_activation_at
```

Package activation tracks attempts and failure fingerprints. Repeated failure for the same package content becomes terminal after the bounded attempt limit, preventing startup retry loops.

When a verified previous package backup exists, Activation Manager may restore and activate that Last-Known-Good package after candidate activation fails.

The host never auto-restarts after install/update/rollback.

## 7. Runtime Adapter ABI

All resources share one Package Model but not one execution implementation.

Runtime Adapter ABI v1 defines:

```text
validate
prepare
bind
activate
health
deactivate
cleanup
```

The canonical adapters are:

```text
PluginRuntimeAdapter
McpRuntimeAdapter
SkillRuntimeAdapter
AgentRuntimeAdapter
```

Type-specific execution logic belongs in adapters instead of proliferating `if type === ...` branches through Transaction or Runtime State code.

## 8. Candidate / Quarantine pipeline

External discovery is never written directly into Registry V4.

Every candidate is classified as:

```text
accepted     → eligible for Registry V4
quarantined  → discoverable but not installable
rejected     → excluded from authority and search
```

Typical quarantine reasons include missing authoritative Manifest V2 and failure to resolve an immutable source commit. Search Index V3 may include quarantined resources with `installable=false`, while Registry V4 remains the only installation authority.

The candidate report is a build/sync diagnostic and is not published as a public installation API.

## 9. Config and Secret boundary

Configuration precedence is:

```text
defaults
→ user package config
→ workspace package config
→ package-instance config
→ effective runtime config
```

Secret values never belong in Registry V4, Runtime State V4, Environment Lock V2, audit events, Marketplace responses, or logs. Those structures hold secret references only. Secret values are mediated by the local secret store and never returned through Local Host HTTP GET.

## 10. Audit contract

Mutation audit events are append-only and contain operational identifiers, package coordinate, Registry revision, resolution hash, policy result, Runtime State generation change, duration, result and recoverability metadata.

Sensitive key names and credential/token/secret/password values are redacted before persistence.

Audit data is diagnostic history, not a second Runtime State authority.

## 11. Environment Lock V2

Environment Lock keeps the public V2 schema and now binds:

- exact package identity/version/commit;
- Registry revision and resolution hash;
- artifact/install metadata;
- immutable CAS content digest;
- supply-chain verification snapshot;
- trust and policy snapshot;
- Runtime Adapter ABI metadata.

Restore is explicit, policy-checked and transactional. It verifies CAS content, reconstructs the install lock, atomically replaces package paths, publishes Runtime State once, and leaves packages pending explicit activation.

## 12. Desktop Marketplace boundary

`packages/dsh-go-marketplace-plugin` uses Manifest V2 and Local Host API V2 only.

It may call remote `/api/v2/*` for discovery, but installation/update/remove/rollback/enable/disable/activation are sent to the authenticated Local Host and Runtime Supervisor. The desktop plugin contains no independent installer, resolver, state writer, secret store or restart implementation.

## 13. Architecture Conformance Gate

`scripts/check-architecture.mjs` prevents architectural drift, including:

- Site → Local Runtime dependency;
- Edge API → local installer/state dependency;
- Resolver filesystem/network/runtime dependency;
- mutation frontends bypassing Supervisor;
- duplicate package parser/SemVer/resolver implementations;
- package-layer circular dependencies;
- legacy API V1, old Deep Link and old Runtime State mirror surfaces;
- missing canonical authorities.

Architecture Conformance runs before release/deployment acceptance.

## 14. Deployment authority

All production deployment paths use Registry V4 and Deployment Gate V4:

```text
Cloudflare Pages/API
GitHub Pages
Tencent EdgeOne Pages
```

The acceptance condition is not “deploy command succeeded.” It is:

```text
exact source SHA
AND exact Registry V4 revision
AND Distribution V2 revision
AND Search Index V3 revision
AND Protocol/API discovery contract
AND no public legacy artifacts
```

Sync V4 owns generated Registry V4/candidate data. Direct unrelated pushes must not masquerade as generated Registry publication.

## 15. Package release contract

Package release consumes only Manifest V2 `dsh-package.json`.

Release flow:

```text
Manifest V2 validate
→ local source permission audit
→ deterministic archive
→ reproducibility comparison
→ canonical immutable tag
→ artifact/SBOM attestation
→ immutable GitHub Release
→ Registry V4 refresh dispatch
```

Local source audit is not equivalent to publisher or cryptographic trust. Those are established separately by release verification and Trust Root policy.

## 16. Removed compatibility architecture

The hardened architecture intentionally removes rather than adapts:

- API V1;
- Runtime V3 implementation tree;
- Registry V3 builder/pipeline/deploy gate;
- Search Index V2 builder;
- Sync V3;
- duplicate Runtime resolver/SemVer/package parser layers;
- old package-manager CLI;
- old Manifest migration/validator path;
- legacy plugin/ecosystem detail routes;
- legacy Deep Link and Runtime State compatibility mirrors.

There is no fallback path back to those contracts.

## 17. Final release acceptance

A V4 release is acceptable only after all of these gates succeed on the exact head revision:

```text
Breaking Contract
Architecture Conformance
TypeScript + lint
Protocol / Policy / Registry / Resolver tests
CAS / Trust / Supervisor / Runtime State / Transaction / Activation tests
full local package lifecycle
Linux / macOS / Windows acceptance
Astro check + site build
Registry V4 / Distribution V2 / Search V3 artifact validation
Deployment Gate V4
npm pack dry-run
Dependency security audit
three-platform exact SHA + Registry V4 convergence
```

Any failing gate means the refactor is not yet releasable.
