// Cloudflare Pages Functions runtime boundary for API V2.
// Discovery projections, legacy catalogs and install command generation do not belong here.
export interface Env {
  ASSETS: {
    fetch: (input: Request | string | URL, init?: RequestInit) => Promise<Response>;
  };
}
