# DSH Go Deployment

This root file is a stable pointer to the canonical V4 deployment contract.

The active deployment guide is [`docs/deployment-v4.md`](docs/deployment-v4.md). It is the only deployment architecture supported by the current codebase.

Current production contract:

```text
Package Protocol V2
Manifest V2
Registry V4
Distribution V2
Search Index V3
API V2 / MCP Tools V2
Runtime State V4
```

Cloudflare Pages is the API authority. GitHub Pages and Tencent EdgeOne are static mirrors. A production deployment is accepted only when the exact Git commit SHA and Registry V4 revision converge across the required targets.

Before deployment, the exact revision must pass:

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

Do not restore API V1, Registry V3, Search Index V2, legacy install commands, legacy Deep Links, Runtime V3 state, or compatibility deployment artifacts to make an old run pass. Fix the V4 contract itself.
