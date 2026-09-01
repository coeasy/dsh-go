# DSH Go Marketplace MCP package

This is the independently packaged DSH MCP layer for the dsh-go Marketplace.
It uses the read-only `https://dsh-go.pages.dev/api/v1/mcp` endpoint and does
not execute shell commands, write files, read secrets, install packages, or
restart the DSH client remotely.

Install it from a DSH Runtime with:

```bash
dsh mcp install dsh-go-marketplace@0.1.2
dsh startup activate
dsh mcp start dsh-go-marketplace
```

After it is active, invoke a discovery tool locally:

```bash
dsh mcp invoke dsh-go-marketplace search_plugins --input '{"q":"mcp","limit":10}'
```

The DSH Runtime performs preflight, permission consent, immutable source or
release-artifact verification, local activation, and runtime network policy
checks. A successful install never restarts the client automatically.
