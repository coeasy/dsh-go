# Provider Adapter Release V1

Provider Adapter Release V1 turns adapters into immutable, reproducible release artifacts without changing Registry V3 or the Plugin/MCP/Skill/Agent lifecycle.

## Invariants

1. `provider-adapter.json` is the source contract and must declare an explicit non-empty `files` list.
2. `id@version` is immutable. Publishing the same release again is an idempotent no-op; publishing different bytes under the same version fails closed.
3. Release archives are deterministic USTAR + gzip artifacts with normalized order, mode, UID/GID and timestamp metadata.
4. Every release records a canonical manifest hash, artifact SHA-256, deterministic release ID, SPDX SBOM and GitHub artifact attestation.
5. `stable`, `beta`, `nightly` and `dev` are mutable pointers to immutable versions. Rollback moves a pointer; it never rewrites or deletes release history.
6. Runtime downloads verify the artifact SHA-256 before extraction, reject traversal/symlink/special archive entries, extract into a temporary directory and activate by atomic state update.
7. Install/update/rollback does not restart the client automatically. Provider state reports `restart_required` so the host can apply its own reload policy.
8. Provider Adapter Registry V1 is parallel to Registry V3. Existing Plugin/MCP/Skill/Agent contracts remain unchanged.

## Manifest

```json
{
  "manifest_version": "1.0.0",
  "id": "deepseek",
  "name": "DeepSeek Provider Adapter",
  "version": "0.1.0",
  "kind": "llm",
  "entrypoint": "src/index.mjs",
  "files": ["src", "LICENSE"],
  "capabilities": ["chat", "tools"],
  "compatibility": {
    "runtime": ">=0.1.0",
    "node": ">=20"
  },
  "publisher": {
    "provider": "github",
    "id": "example"
  },
  "security": {
    "license": "MIT"
  },
  "release": {
    "channel": "stable"
  }
}
```

Supported `kind` values are `llm`, `mcp`, `skill`, and `agent-runtime`.

## Deterministic package output

```bash
node scripts/provider-adapter-pack.mjs provider-adapter.json --out-dir dist
```

Output:

- `<id>-<version>.tgz`
- `provider-adapter-release.json`
- `provider-adapter-sbom.spdx.json`
- `SHA256SUMS`

The packer rejects unsafe paths, symlinks, special files, excessive file counts and excessive unpacked size. Running the packer twice against the same source produces byte-identical outputs.

## Reusable release workflow

Adapter repositories can call the DSH reusable workflow from a tag workflow. For supply-chain stability, pin the reusable workflow to a DSH commit SHA rather than a moving branch.

```yaml
name: Release Provider Adapter
on:
  push:
    tags: ['v*']

permissions:
  contents: write
  id-token: write
  attestations: write

jobs:
  release:
    uses: coeasy/dsh-go/.github/workflows/provider-adapter-release.yml@<DSH_COMMIT_SHA>
    with:
      manifest: provider-adapter.json
      marketplace_repository: coeasy/dsh-go
    secrets:
      marketplace_token: ${{ secrets.DSH_MARKETPLACE_TOKEN }}
```

The called workflow obtains its own immutable `job_workflow_sha` from the GitHub OIDC token and checks out the release toolkit at exactly that SHA. It then:

1. builds the adapter artifact;
2. rebuilds it and compares every release output byte-for-byte;
3. creates build-provenance and SBOM attestations with `actions/attest`;
4. creates a GitHub Release, or verifies an existing release descriptor is byte-identical before a retry;
5. dispatches Marketplace ingestion when `marketplace_token` is configured.

A missing Marketplace token does not invalidate the immutable GitHub Release. It only skips automatic Registry submission.

## Marketplace ingestion

`provider-adapter-marketplace.yml` accepts `repository_dispatch` events or an explicit manual repository/tag/channel request. The ingestion workflow:

- downloads `provider-adapter-release.json` from the source GitHub Release;
- verifies the declared source repository, tag, and release artifact URL;
- updates `catalog/provider-adapters.json` idempotently;
- opens a PR containing only the Registry change.

This keeps the catalog trust boundary reviewable: adapter repositories can request publication, but do not write Marketplace `main` directly.

Manual/local registry publishing uses the same primitive:

```bash
node scripts/provider-adapter-publish.mjs \
  --registry catalog/provider-adapters.json \
  --release dist/provider-adapter-release.json \
  --channel stable
```

Registry channel rollback:

```bash
node scripts/provider-adapter-publish.mjs \
  --registry catalog/provider-adapters.json \
  --rollback \
  --id deepseek \
  --channel stable \
  --to-version 0.1.0
```

## Runtime CLI

Provider adapters are isolated from the existing Runtime Registry and stored below `~/.dsh/providers` by default. Override the home with `DSH_PROVIDER_HOME` and the marketplace source with `DSH_PROVIDER_REGISTRY`.

```bash
dsh provider list
dsh provider search deepseek
dsh provider info deepseek
dsh provider install deepseek@0.1.0
dsh provider install deepseek --channel stable
dsh provider update deepseek
dsh provider status deepseek
dsh provider rollback deepseek
dsh provider rollback deepseek 0.1.0
```

Use `--registry <file-or-url>` for an alternate Provider Adapter Registry V1 source and `--root <directory>` for an isolated runtime home. `install`, `update`, and `rollback` support `--dry-run`.

Installed versions are immutable under `<provider-home>/versions/<id>/<version>`. `state.json` contains only activation pointers and history. Local rollback selects a previously installed immutable version without downloading or rewriting it.

## Marketplace API

Static registry:

- `/catalog/provider-adapters.json`
- `/catalog/provider-adapter.schema.json`
- `/catalog/provider-adapter-registry.schema.json`

Cloudflare Pages API:

- `GET /api/v1/providers`
- `GET /api/v1/providers/:id`

List filters: `kind`, `channel`, `capability`, `search`/`q`, `page`, and `per_page`.

## Compatibility and versioning

Provider Adapter Registry V1 deliberately does not change:

- DSH public runtime version `0.1.0`;
- Registry V3 schema `3.0.0`;
- `/api/v1` compatibility;
- Plugin/MCP/Skill/Agent package model.

Provider Adapter contract changes are independently versioned through `manifest_version` and Provider Adapter Registry `schema_version`.
