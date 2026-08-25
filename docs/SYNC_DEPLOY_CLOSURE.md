# Sync -> Deploy Closure

This closes the final Registry V3 publication gap caused by generated-data commits being pushed with the workflow `GITHUB_TOKEN`.

## Invariant

A deploy-worthy Sync V3 change must follow this chain:

`Sync V3 -> integrity gates -> generated-data commit -> explicit workflow_dispatch -> Cloudflare Pages / GitHub Pages / CN Mirrors -> Monitor hash convergence`

The generated-data push is still kept for an auditable Registry V3 history. Deployment no longer relies on that bot push recursively triggering other push workflows.

## Deployment dispatch

`sync.yml` grants only the additional `actions: write` permission required to dispatch the three existing deployment workflows. Dispatch happens only when:

- a generated commit was actually pushed; and
- deploy-worthy catalog data changed.

Heartbeat-only commits keep the existing `[no deploy]` behavior.

## Monitor gate

The monitor checks out the latest `main` Registry V3 and requires all of these values to converge:

- `main` `catalog/registry-v3.json` hash and count;
- deployed `/api/v1/meta` registry hash;
- deployed `/catalog/registry-v3.json` hash and count;
- deployed `/api/v1/registry` hash.

A bounded retry window allows normal deployment propagation, then fails closed if production is still behind `main`.
