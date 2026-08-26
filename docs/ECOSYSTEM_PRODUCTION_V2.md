# DSH Ecosystem Production Contract

This document defines the production contract for the DSH Plugin + MCP + Skill + Agent ecosystem.

## Stable public version and route contract

The public compatibility boundary is intentionally conservative:

| Surface | Version / route | Rule |
| --- | --- | --- |
| DSH Go product | `0.1.0` | Public product / CLI / site release version. |
| Local DSH runtime | `0.1.0` | Client-facing runtime compatibility version. |
| Remote HTTP API | `/api/v1/...` | Canonical and only public API route family. New capabilities extend v1 compatibly. |
| Remote MCP endpoint | `/api/v1/mcp` | Read-only discovery endpoint; reports server version `0.1.0`. |
| New ecosystem package | `0.1.0` | Default initial package version. |
| Registry format | Registry V3 | Internal canonical catalog data format; not the product release version. |
| Registry schema | `3.0.0` | Internal data-schema version; does not change public API route or product version. |
| Package manifest schema | `1.0.0` | `dsh-package.json` file format; independent from product version. |

Do not infer a product/API version change from internal names such as Registry V3 or historical source directories. Public releases remain `0.1.0` and remote API URLs remain under `/api/v1` until the project explicitly changes that contract.

## Authoritative manifests

Manifest discovery order is:

1. `dsh-package.json` — preferred unified manifest.
2. `dsh-plugin.json` — legacy Plugin compatibility.
3. `dsh-mcp.json` — native MCP package.
4. `dsh-skill.json` — native Skill package.
5. `dsh-agent.json` — native Agent package.

`package.json` remains package-manager metadata and MUST NOT grant Registry verification or override canonical GitHub repository identity.

New package templates start at package version `0.1.0`. Native package repositories can advertise `dsh-package`, `dsh-mcp`, `dsh-skill`, or `dsh-agent` topics. Sync still requires an authoritative DSH manifest before supplementary-topic repositories enter the canonical catalog.

## Canonical ecosystem identity

Local Runtime identity is `(type, id)`, represented as `type:id`. The same id may exist simultaneously as Plugin, MCP, Skill and Agent.

Public routes are not versioned again to encode the type. Existing routes stay stable:

- `/ecosystem/:id?type=mcp`
- `/api/v1/ecosystem/:id?type=mcp`
- `/api/v1/search?type=mcp&q=...`

If an id is ambiguous and no `type` is supplied, API v1 returns an explicit ambiguity response instead of silently choosing the first record.

## Local installation boundary

The website never writes to the local machine directly.

The supported flow is:

`Marketplace -> dsh://install -> local protocol handler or localhost Client Host -> preflight -> explicit user approval -> immutable Git commit install -> restart_required -> manual client restart -> Startup Loader -> commit + compatibility verification -> active`

Automatic client restart is prohibited.

The localhost Client Host binds to `127.0.0.1`, uses a random local bearer token stored under `~/.dsh/bridge-token`, validates allowed browser origins, and exposes authenticated local `/v1/...` control routes. This localhost `/v1` protocol is local-only and does not replace the remote `/api/v1` read-only boundary.

## Runtime lifecycle and execution

All package types share lifecycle operations:

- install / update / repair;
- list / status / health / history;
- enable / disable;
- rollback / remove.

MCP packages additionally support local execution management after startup activation:

- `dsh mcp start|stop|restart|process-status|logs|probe`;
- `dsh mcp invoke <id> <tool>`;
- stdio and remote HTTP/SSE-style transports through the same permission boundary.

Skill packages support:

- `dsh skill load|unload|inspect`;
- `dsh skill invoke <id>`;
- Node and explicitly configured Python executors.

Execution is fail-closed: process execution requires declared `process.spawn`, remote network calls require `network` or `network.unrestricted`, and secret references require `secrets.read`. Optional resource-scoped `permission_policy` rules can further restrict executable names, hosts and secret names.

## Configuration and secrets

Per-package non-secret configuration is stored under `~/.dsh/config/<type>/<id>.json` and can reference secrets with `{ "$secret": "name" }`.

Secrets are never written into package configuration or the Runtime Registry. The local Secret Store encrypts data with AES-256-GCM under `~/.dsh/secrets` and keeps the local master key in a permission-restricted file. CLI commands expose secret names by default and reveal values only through an explicit local request.

## Compatibility preflight

A package can declare:

- operating systems;
- CPU architectures;
- Node.js semver range;
- DSH Runtime semver range;
- DSH Client semver range;
- required host capabilities;
- conflicts, replacements and provided capabilities.

The same compatibility evaluator is used by planning, installation and Startup Loader activation. Internal schema versions may evolve while the public runtime remains `0.1.0`; packages should therefore declare compatibility intentionally rather than assuming an internal Registry schema number is a Runtime release number.

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

High-risk permissions require explicit local consent before install/update. Permission escalation is represented as a diff. `permission_policy` optionally narrows an already declared capability to explicit allow/deny resources; it never grants a capability that was not declared.

## Supply-chain evidence

The marketplace surfaces these signals:

- canonical GitHub repository owner vs publisher identity;
- immutable source commit;
- Registry verification;
- provenance reference + SHA-256 digest;
- signature identity/bundle reference;
- CycloneDX SBOM;
- license declaration;
- advisories, yanked and deprecated status;
- package-source heuristic audit for shell execution, secret access, filesystem writes and network access.

A declared evidence reference is not presented as a completed cryptographic verification. Detail pages show evidence signals rather than inventing a separate trust score. `dsh package publish-check` validates manifest/source consistency and release evidence presence; external signing credentials remain outside this repository.

## Publisher workflow

```bash
# Default package version remains 0.1.0
dsh package init --type skill --id my-skill --name "My Skill"
dsh package validate
dsh package audit
dsh package sbom
dsh package publish-check
```

Publishers then commit the manifest and add the matching DSH topic. Registry Sync pins the repository to an immutable commit before it becomes installable.

## Profiles, Bundles and transactions

A Profile or Bundle is a declarative list of ecosystem packages. `--dry-run` resolves the complete dependency graph and permission plan without local modification.

Real application uses a transaction journal:

1. resolve and preflight the complete graph;
2. stage every package and verify immutable commits;
3. check Runtime Registry generation has not changed;
4. atomically switch package directories;
5. write the Runtime Registry once;
6. preserve rollback copies;
7. recover incomplete transactions on the next startup.

Runtime Registry writes use a local lock and generation compare-and-swap. Package removal checks reverse dependencies and requires `--cascade` before removing dependents.

## Remote API v1

The canonical remote API remains v1. Important endpoints include:

- `/api/v1/search`
- `/api/v1/ecosystem`
- `/api/v1/ecosystem/:id?type=...`
- `/api/v1/plugins`
- `/api/v1/registry`
- `/api/v1/mcp`
- `/api/v1/health`
- `/api/v1/meta`

Remote Pages/MCP surfaces remain read-only. Local mutations only happen through the authenticated local Runtime/Client Host.

## CI / release gates

Production validation includes:

- the `0.1.0` + `/api/v1` compatibility contract;
- TypeScript strict typecheck;
- ESLint;
- legacy lifecycle tests;
- unified Runtime tests;
- completion tests for config/secrets/dependency guards/transactions/local control;
- real local-Git install/update/rollback E2E;
- install -> manual restart -> Startup Loader activation E2E;
- Registry compatibility;
- Astro check and build;
- CLI and protocol-registration smoke on Linux, Windows and macOS.

The production build must never bypass permission, compatibility, Registry integrity, source identity or transaction failures.
