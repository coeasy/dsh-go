const DEFAULT_LOCAL_BASE = 'http://127.0.0.1:43731';
const DEFAULT_MARKETPLACE_BASE = 'https://dsh-go.pages.dev';
const PACKAGE_TYPES = new Set(['plugin', 'mcp', 'skill', 'agent']);
export const DSH_TAURI_IPC_COMMAND = 'dsh_client_host_request';

function trimBase(value) {
  return String(value || '').replace(/\/+$/, '');
}

function assertType(type) {
  const value = String(type || '').trim().toLowerCase();
  if (!PACKAGE_TYPES.has(value)) throw new Error(`unsupported DSH package type: ${value}`);
  return value;
}

function assertId(id) {
  const value = String(id || '').trim().toLowerCase();
  if (!/^[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)?$/.test(value) || value.includes('..')) throw new Error(`invalid DSH package id: ${id}`);
  return value;
}

function canonicalSpec(request, fallbackRange = '*') {
  if (typeof request === 'string') {
    if (!/^(?:plugin|mcp|skill|agent):[^@]+@.+$/.test(request)) throw new Error('canonical package coordinate <type>:<id>@<range> is required');
    return request;
  }
  const type = assertType(request?.type);
  const id = assertId(request?.id);
  const range = String(request?.range || request?.version || fallbackRange).trim() || '*';
  return `${type}:${id}@${range}`;
}

function unwrap(payload) {
  if (payload && typeof payload === 'object' && 'data' in payload) return payload.data;
  return payload;
}

async function parseResponse(response) {
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const detail = body?.error && typeof body.error === 'object' ? body.error : body;
    const error = new Error(detail?.message || body?.error || body?.message || `DSH request failed: HTTP ${response.status}`);
    error.code = detail?.code || body?.code || 'DSH_DESKTOP_REQUEST_FAILED';
    error.status = response.status;
    error.response = body;
    throw error;
  }
  return unwrap(body);
}

function bodyValue(init = {}) {
  if (!init.body) return null;
  if (typeof init.body !== 'string') return init.body;
  try { return JSON.parse(init.body); } catch { return init.body; }
}

function remotePackagePath(type, id) {
  const parts = assertId(id).split('/').map(encodeURIComponent);
  return `/api/v2/packages/${encodeURIComponent(assertType(type))}/${parts.join('/')}`;
}

export function createMarketplaceDesktopClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
  const invoke = typeof options.invoke === 'function' ? options.invoke : null;
  const localBaseUrl = trimBase(options.localBaseUrl || DEFAULT_LOCAL_BASE);
  const marketplaceBaseUrl = trimBase(options.marketplaceBaseUrl || DEFAULT_MARKETPLACE_BASE);
  const token = String(options.token || '');

  async function local(path, init = {}) {
    if (!token) {
      const error = new Error('DSH Client Host bearer token is required');
      error.code = 'DSH_DESKTOP_TOKEN_REQUIRED';
      throw error;
    }
    if (invoke) {
      const result = await invoke(DSH_TAURI_IPC_COMMAND, {
        request: {
          api: 'v2',
          path,
          method: init.method || 'GET',
          body: bodyValue(init),
          token,
        },
      });
      if (result?.error) {
        const error = new Error(result.error.message || 'DSH local IPC request failed');
        error.code = result.error.code || 'DSH_DESKTOP_REQUEST_FAILED';
        throw error;
      }
      return unwrap(result);
    }
    const headers = new Headers(init.headers || {});
    headers.set('authorization', `Bearer ${token}`);
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    return parseResponse(await fetchImpl(`${localBaseUrl}${path}`, { ...init, headers, cache: 'no-store' }));
  }

  async function health() {
    if (invoke) {
      const result = await invoke(DSH_TAURI_IPC_COMMAND, { request: { api: 'v2', path: '/health', method: 'GET', body: null, token } });
      return unwrap(result);
    }
    return parseResponse(await fetchImpl(`${localBaseUrl}/health`, { cache: 'no-store' }));
  }

  async function marketplace(path, params = {}) {
    const url = new URL(path, `${marketplaceBaseUrl}/`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    return parseResponse(await fetchImpl(url, { cache: 'no-store', headers: { accept: 'application/json' } }));
  }

  async function runtimeStatus() { return local('/v2/runtime/status'); }
  async function registryStatus() { return local('/v2/registry/status'); }
  async function installed({ all = false } = {}) { return local(`/v2/packages?all=${all ? 'true' : 'false'}`); }

  async function center() {
    const [runtime, installedResult, registry] = await Promise.all([runtimeStatus(), installed(), registryStatus()]);
    const packages = installedResult?.packages || [];
    const counts = { installed: packages.length, active: 0, pending_activation: 0, failed: 0, disabled: 0 };
    for (const item of packages) {
      if (item.state === 'active' || item.activated === true) counts.active += 1;
      if (item.state === 'pending-restart' || item.restart_required === true) counts.pending_activation += 1;
      if (item.state === 'failed') counts.failed += 1;
      if (item.state === 'disabled' || item.enabled === false) counts.disabled += 1;
    }
    return {
      runtime,
      registry,
      packages,
      counts,
      restart_required: packages.some((item) => item.restart_required === true),
      mutation_authority: runtime?.mutation_authority || 'Runtime Supervisor',
      auto_restart: false,
    };
  }

  async function installPlan(request) {
    return local('/v2/install/plan', {
      method: 'POST',
      body: JSON.stringify({ spec: canonicalSpec(request), channel: request?.channel || 'stable' }),
    });
  }

  async function install(request, options = {}) {
    if (options.approved !== true) return { executed: false, confirmation_required: true, request, auto_restart: false };
    return local('/v2/install/execute', {
      method: 'POST',
      body: JSON.stringify({ spec: canonicalSpec(request), channel: request?.channel || 'stable', approved: true, dry_run: options.dryRun === true }),
    });
  }

  async function packageAction(type, id, action, options = {}) {
    const normalizedAction = String(action || '').trim().toLowerCase();
    if (!['update', 'remove', 'rollback', 'enable', 'disable', 'verify'].includes(normalizedAction)) throw new Error(`unsupported package action: ${action}`);
    if (options.approved !== true) return { executed: false, confirmation_required: true, type, id, action: normalizedAction, auto_restart: false };
    return local('/v2/packages/action', {
      method: 'POST',
      body: JSON.stringify({ spec: canonicalSpec({ type, id, range: options.range || '*' }), action: normalizedAction, approved: true }),
    });
  }

  async function activate(options = {}) {
    if (options.approved !== true) return { executed: false, confirmation_required: true, action: 'activate', auto_restart: false };
    return local('/v2/runtime/activate', { method: 'POST', body: JSON.stringify({ approved: true }) });
  }

  return Object.freeze({
    localBaseUrl,
    marketplaceBaseUrl,
    transport: invoke ? 'tauri-ipc' : 'client-host-http',
    health,
    contract: () => local('/v2/contract'),
    center,
    runtimeStatus,
    registryStatus,
    installed,
    search: (query, options = {}) => marketplace('/api/v2/search', { q: query, type: options.type, limit: options.limit || 50 }),
    packageDetail: (id, options = {}) => marketplace(remotePackagePath(options.type, id)),
    installPlan,
    install,
    packageAction,
    removePackage: (type, id, options = {}) => packageAction(type, id, 'remove', options),
    verifyPackage: (type, id, options = {}) => packageAction(type, id, 'verify', options),
    activate,
    canonicalSpec,
  });
}

export const marketplaceDesktopPlugin = Object.freeze({
  id: 'coeasy/dsh-go-marketplace-plugin',
  version: '0.1.2',
  package_protocol: 2,
  local_api: 'v2',
  registry_schema: 4,
  ipc_command: DSH_TAURI_IPC_COMMAND,
  remote_role: 'discovery-only',
  local_role: 'runtime-supervisor-client',
  auto_restart: false,
});
