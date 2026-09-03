const DEFAULT_LOCAL_BASE = 'http://127.0.0.1:43731';
const DEFAULT_MARKETPLACE_BASE = 'https://dsh-go.pages.dev';
const PACKAGE_TYPES = new Set(['plugin', 'mcp', 'skill', 'agent']);

function trimBase(value) {
  return String(value || '').replace(/\/+$/, '');
}

function assertType(type) {
  const value = String(type || 'plugin').toLowerCase();
  if (!PACKAGE_TYPES.has(value)) throw new Error(`unsupported DSH package type: ${value}`);
  return value;
}

async function parseResponse(response) {
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const error = new Error(body?.error || body?.message || `DSH request failed: HTTP ${response.status}`);
    error.code = body?.code || 'DSH_DESKTOP_REQUEST_FAILED';
    error.status = response.status;
    error.response = body;
    throw error;
  }
  return body;
}

export function createMarketplaceDesktopClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
  const localBaseUrl = trimBase(options.localBaseUrl || DEFAULT_LOCAL_BASE);
  const marketplaceBaseUrl = trimBase(options.marketplaceBaseUrl || DEFAULT_MARKETPLACE_BASE);
  const token = String(options.token || '');

  async function local(path, init = {}) {
    if (!token) {
      const error = new Error('DSH Client Host bearer token is required');
      error.code = 'DSH_DESKTOP_TOKEN_REQUIRED';
      throw error;
    }
    const headers = new Headers(init.headers || {});
    headers.set('authorization', `Bearer ${token}`);
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    return parseResponse(await fetchImpl(`${localBaseUrl}${path}`, { ...init, headers }));
  }

  async function marketplace(path, params = {}) {
    const url = new URL(path, `${marketplaceBaseUrl}/`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    return parseResponse(await fetchImpl(url));
  }

  return Object.freeze({
    localBaseUrl,
    marketplaceBaseUrl,
    health: () => parseResponse(fetchImpl(`${localBaseUrl}/health`)),
    contract: () => local('/v1/desktop/contract'),
    center: () => local('/v1/desktop/center'),
    enterprisePolicy: () => local('/v1/enterprise/policy'),
    search: (query, options = {}) => marketplace('/api/v1/marketplace', {
      q: query,
      type: options.type,
      locale: options.locale,
      limit: options.limit || 40,
    }),
    packageDetail: (id, options = {}) => marketplace('/api/v1/package-detail', {
      id,
      type: options.type,
      version: options.version,
      channel: options.channel,
      locale: options.locale,
    }),
    installPlan: (request) => local('/v1/install/plan', { method: 'POST', body: JSON.stringify(request || {}) }),
    install: async (request, options = {}) => {
      if (options.approved !== true) return { executed: false, confirmation_required: true, request, auto_restart: false };
      return local('/v1/install/execute', { method: 'POST', body: JSON.stringify({ ...(request || {}), approved: true }) });
    },
    packageAction: async (type, id, action, options = {}) => {
      if (options.approved !== true) return { executed: false, confirmation_required: true, type, id, action, auto_restart: false };
      const normalizedType = assertType(type);
      return local(`/v1/packages/${normalizedType}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ action, version: options.version, approved: true }),
      });
    },
    removePackage: async (type, id, options = {}) => {
      if (options.approved !== true) return { executed: false, confirmation_required: true, type, id, action: 'remove', auto_restart: false };
      const normalizedType = assertType(type);
      return local(`/v1/packages/${normalizedType}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        body: JSON.stringify({ approved: true, cascade: options.cascade === true }),
      });
    },
    restartIntent: () => ({
      requested: true,
      delegated_to_host: true,
      event: 'dsh:restart-requested',
      auto_restart: false,
    }),
  });
}

export const marketplaceDesktopPlugin = Object.freeze({
  id: 'dsh-go-marketplace-plugin',
  version: '0.1.0',
  local_protocol: 'dsh-client-host-v1',
  remote_role: 'discovery-only',
  local_role: 'authenticated-package-manager-ipc',
  auto_restart: false,
});
