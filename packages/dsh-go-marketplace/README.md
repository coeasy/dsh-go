# DSH Go Marketplace MCP package

This is the independently packaged read-only MCP discovery layer for DSH Go Marketplace.
It uses the canonical `https://dsh-go.pages.dev/api/v2/mcp` endpoint and Manifest V2.
The remote service can search, inspect, resolve, and create install plans, but it cannot
write local Runtime State, read local secrets, install packages, or restart a DSH client.

The canonical package coordinate is:

```text
mcp:coeasy/dsh-go-marketplace@0.1.3
```

Install and activate it through the local Runtime Supervisor:

```bash
dsh package install mcp:coeasy/dsh-go-marketplace@0.1.3 --yes
dsh runtime activate --yes
```

Inspect the package locally with:

```bash
dsh package info mcp:coeasy/dsh-go-marketplace@0.1.3
```

Package installation performs Registry V4 resolution against an immutable Release Descriptor V2,
then applies policy and permission evaluation, artifact digest verification,
content-addressable storage, one transactional Runtime State V4 publish, and explicit activation.
Successful installation never restarts the host automatically.
