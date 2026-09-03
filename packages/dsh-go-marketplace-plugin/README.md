# DSH Go Marketplace Desktop Plugin

`dsh-go-marketplace-plugin` is the desktop/Tauri-compatible Marketplace presentation layer for DSH.

It deliberately does **not** implement a second installer. Remote Marketplace APIs are used only for discovery and package metadata. Every local mutation is delegated to the authenticated DSH Client Host and ultimately to the existing Package Manager Core.

## Host integration

Before loading `ui/index.html`, the desktop host injects a configuration object:

```js
globalThis.__DSH_DESKTOP__ = {
  token: '<local bridge token>',
  localBaseUrl: 'http://127.0.0.1:43731',
  marketplaceBaseUrl: 'https://dsh-go.pages.dev',
  locale: 'en'
};
```

The plugin reads:

- `/v1/desktop/contract` for the local IPC contract;
- `/v1/desktop/center` for installed/update/pending-restart/security state;
- `/v1/enterprise/policy` for organization policy status;
- `/v1/install/plan` for a non-mutating install preview;
- `/v1/install/execute` and package action endpoints only after explicit user approval.

## Restart contract

Install/update/rollback can leave packages in `pending-restart`. The plugin never restarts the host itself. Selecting **Restart DSH** emits the `dsh:restart-requested` browser event; the surrounding desktop shell owns the restart decision and lifecycle.

This keeps the core invariant intact: Marketplace discovers, Package Manager installs, Runtime activates.
