# Sync -> Deploy Closure

This closes the Registry V3 publication gap caused by generated-data commits being pushed with the workflow `GITHUB_TOKEN`, while preserving the low-cost incremental Sync model for normal development.

## Invariant

Every production deployment has exactly one authority and one immutable revision:

- ordinary `main` pushes -> `Deploy Router` -> explicit `workflow_dispatch(commit_sha)`;
- Registry-owned pushes -> `Sync V3` -> integrity gates -> authoritative commit SHA -> explicit `workflow_dispatch(commit_sha)`;
- scheduled/manual Registry updates -> deploy only when deploy-worthy generated data changed.

All deployment targets receive the same `commit_sha`:

`Cloudflare Pages / GitHub Pages / CN Mirrors / Tencent EdgeOne`

Provider workflows do not independently react to `push`, which eliminates the old push-vs-Sync race.

## Deploy Router

`.github/workflows/deploy-router.yml` owns ordinary code/site deployment pushes. It classifies changed files before dispatching providers.

The following paths remain owned by Sync V3 and are deferred instead of deployed immediately:

- `scripts/sync*.mjs`
- `scripts/registry-pipeline-v3.mjs`
- `catalog/schema-v3.json`
- `catalog/overrides.json`
- `.github/workflows/sync.yml`

The router also rejects direct human publication of generated catalog files (`plugins.json`, `registry-v3.json`, feed/meta/audit outputs). Generated Registry V3 state must continue to flow through Sync V3.

## Sync V3

The narrowed Sync trigger and incremental push mode are preserved. A push that touches Sync-owned files runs the integrity gates first, then dispatches the deployment targets at `steps.publish.outputs.commit_sha` even when the registry content did not need a new generated-data commit.

Scheduled/manual Sync runs keep the previous behavior: provider deployment is dispatched only after deploy-worthy generated data changed and was published.

## Exact revision deployment

Every provider workflow accepts a `commit_sha` input and checks out that exact revision. A revision mismatch fails before build/deploy.

This prevents a race where `main` advances after routing or Sync finishes but before a provider job starts. All targets consume the same Registry V3, schema, site source, and runtime revision.

## Deployment targets

- `deploy.yml` — Cloudflare Pages.
- `deploy-pages.yml` — GitHub Pages.
- `deploy-mirror.yml` — existing Gitee/GitCode mirrors; retained as requested.
- `deploy-edgeone.yml` — Tencent EdgeOne Makers static deployment.

Each target remains manually dispatchable.

## Tencent EdgeOne

EdgeOne is optional until `EDGEONE_API_TOKEN` is configured. If the secret is absent, the EdgeOne workflow reports a warning and exits successfully without attempting deployment.

Create the Pages/Makers API Token from the Tencent Cloud EdgeOne console API Token tab:

`https://console.cloud.tencent.com/edgeone/pages?tab=api`

Configure the GitHub repository secret:

- `EDGEONE_API_TOKEN` — required to deploy.

Optional repository variables:

- `EDGEONE_PROJECT` — EdgeOne project name; defaults to `dsh-go`.
- `EDGEONE_CLI_VERSION` — pinned CLI version; defaults to `1.6.28`.
- `EDGEONE_SITE_URL` — stable production/custom-domain URL used for post-deploy and scheduled convergence checks.

EdgeOne is intentionally deployed as a static mirror. API requests continue to use the Cloudflare Pages API URL so the existing Cloudflare Pages Functions implementation remains the single dynamic API authority.

## Cloudflare Pages migration

The deprecated `cloudflare/pages-action@v1` path is replaced with `cloudflare/wrangler-action@v4` and `wrangler pages deploy`.

Wrangler is executed from the repository root, where the root `functions/` directory is available for Pages Functions, and deployment receives the authoritative revision through `--commit-hash`.

## Convergence gates

Provider deployment jobs validate that the deployed Registry V3 hash and plugin count match the exact checked-out revision when a stable deployment URL is available.

The scheduled monitor requires:

- Cloudflare Registry V3/API convergence with latest `main`;
- Registry data freshness below 36 hours;
- GitHub Pages static Registry V3 convergence;
- EdgeOne static Registry V3 convergence when `EDGEONE_SITE_URL` is configured.

CN Mirrors remain operational but are not included in the strict scheduled convergence gate because their Pages publication behavior can depend on provider-side activation outside the Git push itself.
