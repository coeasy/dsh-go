# DSH Go Marketplace Desktop Plugin

`coeasy/dsh-go-marketplace-plugin` is the desktop/Tauri-compatible Marketplace presentation layer for DSH Go V4.

The plugin deliberately owns **no installer, resolver, Runtime State writer, Registry writer, secret store, or restart mechanism**. Remote Marketplace API V2 is discovery-only. Every local mutation is delegated to the authenticated Local Host API V2, which routes it through Runtime Supervisor.

## Host integration

Before loading `ui/index.html`, the desktop host injects:

```js
globalThis.__DSH_DESKTOP__ = {
  token: '<local bridge token>',
  localBaseUrl: 'http://127.0.0.1:43731',
  marketplaceBaseUrl: 'https://dsh-go.pages.dev',
  locale: 'en'
};
```

The desktop client uses:

- `GET /v2/contract` for the Local Host contract;
- `GET /v2/runtime/status` and `GET /v2/packages` for local status;
- `GET /v2/registry/status` for the active Registry V4 revision;
- `POST /v2/install/plan` for a non-mutating local resolution preview;
- `POST /v2/install/execute` only after explicit approval;
- `POST /v2/packages/action` for update/remove/rollback/enable/disable/verify;
- `POST /v2/runtime/activate` for explicit pending-package activation.

Remote discovery uses only `/api/v2/*`. It cannot mutate the user machine and cannot override the local Registry from a Deep Link or web page.

## Activation contract

Install/update/rollback leave packages pending activation. The plugin does not restart DSH automatically. Selecting **Activate pending packages** asks the authenticated Runtime Supervisor to perform Activation Manager preflight, Runtime Adapter binding, health checks, and Last-Known-Good recovery.

The invariant is:

```text
Marketplace discovery
  → Package Protocol V2 request
  → Local Runtime Supervisor
  → Resolver / Policy / Transaction / CAS
  → Runtime State V4
  → explicit activation
```
