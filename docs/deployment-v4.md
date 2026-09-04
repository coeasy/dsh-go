# DSH Go V4 Deployment Guide

This is the canonical deployment guide for the breaking V4 architecture. Old Registry V3, Search Index V2, API V1 and compatibility deployment instructions are not valid.

## Authority

Production content is built from the exact Git commit and the committed Registry V4 authority:

```text
catalog/registry-v4.json
```

The private candidate report may exist in the repository as a Sync V4 diagnostic but must never be published as an installation API.

Public build artifacts include:

```text
/catalog/registry-v4.json
/catalog/registry-v4/index.json      # Distribution V2
/catalog/search-index-v3.json        # installable + discovery-only search
/.well-known/dsh-marketplace.json    # Protocol V2/API V2/Registry V4 discovery
/openapi.json                        # API V2 only
/version.json                        # exact deployment Git SHA
```

## Build acceptance

Before a deployment may run:

```bash
npm ci
cd site && npm ci && cd ..
npm run contract:check
npm run architecture:check
npm run typecheck
npm run lint
npm test
cd site && npm run check && npm run build && cd ..
npm run deploy:gate
npm pack --dry-run
```

Deployment Gate V4 verifies exact Registry V4 revision, Distribution V2 revision, Search Index V3 revision/counts, Platform Discovery V2, API V2 OpenAPI, public file limits, and absence of legacy public artifacts.

## Platforms

### Cloudflare Pages/API

`.github/workflows/deploy.yml` builds the exact requested commit, runs V4 gates, deploys the static/API site, then checks exact SHA and exact Registry V4 revision on the production target.

Cloudflare remains the API authority because GitHub Pages and EdgeOne are static mirrors.

### GitHub Pages

`.github/workflows/deploy-pages.yml` builds with the repository base path, publishes `.well-known` through `.nojekyll`, then checks exact SHA and Registry V4 revision.

### Tencent EdgeOne

`.github/workflows/deploy-edgeone.yml` builds the same canonical artifact contract and uses the pinned EdgeOne CLI control plane. Production acceptance checks the deployment URL and configured stable domain separately and requires exact SHA + Registry V4 revision convergence.

## Sync V4 ownership

`.github/workflows/sync.yml` owns generated discovery/Registry data.

```text
external discovery
→ candidate normalize
→ quarantine/reject
→ accepted Registry V4
→ private candidate report
→ validation
→ generated commit
→ deploy dispatch
```

Unrelated direct pushes must not publish generated Registry data as if they were Sync V4 output.

## Release freeze

A release tag or production version may only be created from an immutable 40-character commit SHA that passes Release Freeze Gate. The gate uses the same V4 contracts as CI and deployment.

## Production convergence

A deployment is complete only when the target proves:

```text
version.json.git_sha == expected commit SHA
AND
remote Registry V4 revision == local Registry V4 revision
AND
remote package count == local package count
```

Static file upload success by itself is not release acceptance.

## Failure recovery

When deployment fails:

1. classify whether the failure is build/contract, platform upload, exact-SHA convergence, or Registry V4 convergence;
2. fix the failing V4 contract rather than restoring a V1/V2/V3 compatibility artifact;
3. rerun the exact failed revision or create a new fix revision;
4. do not mark release complete until all required production targets converge.
