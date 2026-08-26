# DSH Ecosystem Production V2

This document is the production contract for the Plugin + MCP + Skill + Agent ecosystem implemented by Runtime Platform V3 and Marketplace V2.

## Version boundaries

| Surface | Version | Rule |
| --- | --- | --- |
| DSH Go platform | 2.3.0 | Product/site release version. |
| Local runtime | 3.0.0 | Client-facing runtime and compatibility version. |
| Registry | 3 | Canonical static registry format. |
| Registry schema | 3.0.0 | Backward-compatible optional ecosystem fields only. |
| Package manifest | 1.0.0 | `dsh-package.json` contract. |
| New ecosystem package | 0.1.0 | Default initial package version. |

These versions MUST NOT be treated as the same lifecycle.

## Authoritative manifests

Manifest discovery order is:

1. `dsh-package.json` — preferred unified manifest.
2. `dsh-plugin.json` — legacy Plugin compatibility.
3. `dsh-mcp.json` — native MCP package.
4. `dsh-skill.json` — native Skill package.
5. `dsh-agent.json` — native Agent package.

`package.json` remains package-manager metadata and MUST NOT grant Registry verification or override canonical GitHub repository identity.

Native package repositories can advertise `dsh-package`, `dsh-mcp`, `dsh-skill`, or `dsh-agent` topics. Sync still requires an authoritative DSH manifest before supplementary-topic repositories enter the canonical catalog.

## Local installation boundary

The website never writes to the local machine directly.

The supported flow is:

`Marketplace -> dsh://install -> local protocol handler or localhost Client Host -> preflight -> explicit user approval -> immutable Git commit install -> restart_required -> manual client restart -> Startup Loader -> commit + compatibility verification -> active`

Automatic client restart is intentionally prohibited.

The localhost Client Host binds to `127.0.0.1`, uses a random local bearer token stored under `~/.dsh/bridge-token`, separates plan and execute endpoints, and requires `approved: true` for execution.

## Compatibility preflight

A package can declare:

- operating systems;
- CPU architectures;
- Node.js semver range;
- DSH Runtime semver range;
- DSH Client semver range;
- required host capabilities;
- conflicts, replacements, and provided capabilities.

The same compatibility evaluator is used by CLI planning, installation, and Startup Loader activation so the marketplace cannot claim a package is installable while the runtime rejects it for a different rule.

## Permission model

Known permissions:

- `filesystem.read`
- `filesystem.write`
- `network`
- `network.unrestricted`
- `shell`
- `secrets.read`
- `mcp.tools`
- `process.spawn`

High-risk permissions require explicit local consent before install/update. Permission escalation is represented as a diff so update UIs can show newly requested capabilities.

## Supply-chain evidence

Marketplace V2 supports these publisher/release signals:

- canonical GitHub repository owner vs publisher identity;
- immutable source commit;
- Registry verification;
- provenance reference + SHA-256 digest;
- signature identity/bundle reference;
- CycloneDX SBOM;
- SPDX-style license declaration;
- advisories, yanked and deprecated status;
- package-source heuristic audit for shell execution, secret access, filesystem writes and network access.

`dsh package publish-check` combines manifest validation and local source audit. Cryptographic signature verification should be performed by the publisher's CI/release system before attaching the signature/provenance references; Marketplace V2 validates that those references are internally consistent and exposes them in trust scoring.

## Publisher workflow

```bash
# 1. Generate a manifest; default package version is 0.1.0
dsh package init --type skill --id my-skill --name "My Skill"

# 2. Validate the type-specific contract
dsh package validate

# 3. Review code/permission risk
dsh package audit

# 4. Generate CycloneDX SBOM
dsh package sbom

# 5. Run the publish gate
dsh package publish-check
```

Publishers then commit the manifest and add the matching DSH topic. Registry Sync pins the repository to an immutable commit before it becomes installable.

## Marketplace / search architecture

The static Registry V3 snapshot remains canonical and deployable through GitHub Pages / Cloudflare Pages. Search Index V2 is a derived artifact. `StaticRegistrySearchProvider` is the default; KV/D1 adapters can replace only the query accelerator without becoming the source of truth.

## Profiles and Bundles

A Profile or Bundle is a declarative list of ecosystem packages. `--dry-run` performs the full resolve/compatibility/permission plan without local modification. Real application installs every entry through the same Runtime V3 guardrails and ends with one manual-restart requirement.

## CI / release gates

Runtime Platform V3 validates:

- TypeScript strict typecheck;
- ESLint;
- legacy Runtime lifecycle tests;
- Production V2 tests;
- real local-Git install/update/rollback E2E;
- install -> manual restart semantics -> Startup Loader activation E2E;
- Registry V3 compatibility;
- Astro check and build;
- CLI smoke and protocol-registration dry-run on Linux, Windows and macOS.

The production build must never bypass these gates by ignoring peer-dependency, permission, compatibility, Registry integrity or source-identity failures.

## Phase status

- Phase 7 — Client Integration: implemented in Runtime Platform V3.
- Phase 8 — Native Ecosystem Packages: implemented with unified + type-native manifests and native discovery topics.
- Phase 9 — Supply Chain Security: implemented as permission, publisher, provenance/signature/SBOM, audit and trust layers.
- Phase 10 — Marketplace Production: implemented with package detail/install surfaces, Profiles/Bundles, distributable CLI, search-provider boundary and cross-platform gates.

Operational publication to npm or signing infrastructure is a release operation, not a source-code migration. It requires the project's external registry/signing credentials and should be performed only by an authorized release workflow after the code PR is merged.
