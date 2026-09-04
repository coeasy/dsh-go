import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  normalizePackageType,
  packageKey,
  parsePackageCoordinate,
} from '../packages/protocol-core/index.mjs';
import { parseDshUri } from './host-bridge.mjs';
import {
  installPackageRequest,
  listPackages,
  packageInfo,
  planPackage,
  removePackageRequest,
  rollbackPackageRequest,
  runtimeStatus,
  setPackageEnabled,
  updatePackageRequest,
  verifyPackageRequest,
} from './package-service.mjs';
import { activatePendingPackages } from './startup.mjs';
import { readPackageConfig, redactConfig, setPackageConfig, unsetPackageConfig } from './config-store.mjs';
import { deleteSecret, listSecrets, setSecret } from './secret-store.mjs';
import { loadRuntimeRegistryV4 } from './registry-client.mjs';
import { withFileLock } from './file-lock.mjs';

const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_ALLOWED_ORIGINS = new Set(['https://coeasy.github.io', 'https://dsh-go.pages.dev']);

export function bridgeTokenFile() {
  return process.env.DSH_BRIDGE_TOKEN_FILE || join(homedir(), '.dsh', 'bridge-token-v2');
}

export async function ensureBridgeToken(file = bridgeTokenFile()) {
  const target = resolve(file);
  return withFileLock(`${target}.lock`, async () => {
    try {
      const value = (await readFile(target, 'utf8')).trim();
      if (value.length >= 64) return value;
    } catch { /* create below */ }
    await mkdir(dirname(target), { recursive: true });
    const value = randomBytes(32).toString('hex');
    const temp = `${target}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`;
    try {
      await writeFile(temp, `${value}\n`, { encoding: 'utf8', mode: 0o600 });
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {});
      throw error;
    }
    try { await chmod(target, 0o600); } catch { /* Windows ACLs are managed by the OS */ }
    return value;
  });
}

function authenticated(req, token) {
  const raw = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!raw || raw.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(raw), Buffer.from(token));
}

function allowedOrigin(origin) {
  if (!origin) return null;
  const configured = String(process.env.DSH_BRIDGE_ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean);
  const allowed = configured.length ? new Set(configured) : DEFAULT_ALLOWED_ORIGINS;
  if (allowed.has(origin)) return origin;
  if (/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin)) return origin;
  return null;
}

async function body(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      const error = new Error('request body is too large');
      error.code = 'DSH_REQUEST_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try { return JSON.parse(text); } catch {
    const error = new Error('request body must be valid JSON');
    error.code = 'DSH_INVALID_REQUEST';
    throw error;
  }
}

function responseHeaders(req, extra = {}) {
  const origin = allowedOrigin(String(req.headers.origin || ''));
  return {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-dsh-api-version': 'v2',
    'x-content-type-options': 'nosniff',
    ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
    ...extra,
  };
}

function json(req, res, status, payload) {
  const text = `${JSON.stringify(payload)}\n`;
  res.writeHead(status, { ...responseHeaders(req), 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function requireApproval(request) {
  if (request?.approved !== true) {
    const error = new Error('explicit local approval required');
    error.code = 'DSH_APPROVAL_REQUIRED';
    throw error;
  }
}

function localOptions(options, request = {}) {
  return {
    registry: request.registry || options.registry,
    registryFile: options.runtimeRegistry || options.registryFile,
    channel: request.channel || 'stable',
    approved: request.approved === true,
    dryRun: request.dry_run === true,
    force: request.force === true,
    environment: request.environment || options.environment || {},
  };
}

function coordinateFromRoute(type, encodedId, request = {}) {
  const normalizedType = normalizePackageType(type);
  const id = decodeURIComponent(encodedId);
  const range = String(request.range || request.version || '*').trim() || '*';
  return `${normalizedType}:${id}@${range}`;
}

function packageRoute(pathname) {
  const match = pathname.match(/^\/v2\/packages\/(plugin|mcp|skill|agent)\/([^/]+)(?:\/(config|verify))?$/i);
  if (!match) return null;
  return { type: normalizePackageType(match[1]), id: match[2], action: match[3] || null };
}

function secretRoute(pathname) {
  const match = pathname.match(/^\/v2\/secrets(?:\/([^/]+))?$/);
  return match ? { name: match[1] ? decodeURIComponent(match[1]) : null } : null;
}

function errorStatus(error) {
  if (error.code === 'DSH_APPROVAL_REQUIRED' || error.code === 'DSH_PERMISSION_DENIED') return 409;
  if (error.code === 'DSH_REQUEST_TOO_LARGE') return 413;
  if (error.code === 'DSH_PACKAGE_NOT_FOUND') return 404;
  if (error.code === 'DSH_PACKAGE_REVOKED' || error.code === 'DSH_PACKAGE_YANKED' || error.code === 'DSH_SECURITY_ADVISORY_BLOCKED' || error.code === 'DSH_DEPENDENCY_CONFLICT') return 409;
  return 400;
}

export function localHostContract() {
  return {
    api: '/v2',
    protocol_version: 2,
    runtime_state_schema: 4,
    registry_schema: 4,
    authentication: 'Bearer token',
    remote_registry_override_in_deep_link: false,
    auto_restart: false,
    endpoints: {
      runtime_status: 'GET /v2/runtime/status',
      runtime_activate: 'POST /v2/runtime/activate',
      packages: 'GET /v2/packages',
      package: 'GET /v2/packages/:type/:encodedId',
      package_config: 'GET|PATCH /v2/packages/:type/:encodedId/config',
      install_plan: 'POST /v2/install/plan',
      install_execute: 'POST /v2/install/execute',
      package_action: 'POST /v2/packages/action',
      registry_status: 'GET /v2/registry/status',
      secrets: 'GET|PUT|DELETE /v2/secrets/:name',
    },
  };
}

export async function createClientHost(options = {}) {
  const token = options.token || await ensureBridgeToken(options.tokenFile);
  const host = options.host || '127.0.0.1';
  const port = Number(options.port ?? process.env.DSH_BRIDGE_PORT ?? 43731);
  const server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || '/', `http://${host}:${port || 80}`);
      if (req.method === 'OPTIONS') {
        const origin = allowedOrigin(String(req.headers.origin || ''));
        if (!origin) return json(req, res, 403, { error: { code: 'DSH_ORIGIN_DENIED', message: 'origin not allowed' } });
        res.writeHead(204, responseHeaders(req, {
          'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'access-control-allow-headers': 'Authorization, Content-Type',
          'access-control-max-age': '600',
        }));
        return res.end();
      }

      if (requestUrl.pathname === '/health' && req.method === 'GET') {
        return json(req, res, 200, { data: { ok: true, service: 'dsh-client-host', api: '/v2', protocol_version: 2, runtime_state_schema: 4 }, meta: {} });
      }
      if (!authenticated(req, token)) return json(req, res, 401, { error: { code: 'DSH_UNAUTHORIZED', message: 'unauthorized' }, meta: {} });

      if (requestUrl.pathname === '/v2/contract' && req.method === 'GET') return json(req, res, 200, { data: localHostContract(), meta: {} });
      if (requestUrl.pathname === '/v2/runtime/status' && req.method === 'GET') {
        return json(req, res, 200, { data: await runtimeStatus(localOptions(options)), meta: {} });
      }
      if (requestUrl.pathname === '/v2/runtime/activate' && req.method === 'POST') {
        const request = await body(req); requireApproval(request);
        return json(req, res, 200, { data: await activatePendingPackages({ registryFile: options.runtimeRegistry || options.registryFile }), meta: {} });
      }
      if (requestUrl.pathname === '/v2/registry/status' && req.method === 'GET') {
        const registry = await loadRuntimeRegistryV4({ registry: options.registry });
        return json(req, res, 200, { data: { schema_version: 4, revision: registry.revision, generated_at: registry.generated_at, package_count: registry.packages.length }, meta: { registry_revision: registry.revision } });
      }
      if (requestUrl.pathname === '/v2/install/plan' && req.method === 'POST') {
        const request = await body(req);
        const target = request.url ? parseDshUri(request.url).request : parsePackageCoordinate(request.spec, { channel: request.channel || 'stable' });
        const plan = await planPackage(target, localOptions(options, request));
        return json(req, res, 200, { data: plan, meta: { registry_revision: plan.registry_revision } });
      }
      if (requestUrl.pathname === '/v2/install/execute' && req.method === 'POST') {
        const request = await body(req); requireApproval(request);
        const target = request.url ? parseDshUri(request.url).request : parsePackageCoordinate(request.spec, { channel: request.channel || 'stable' });
        const result = await installPackageRequest(target, localOptions(options, request));
        return json(req, res, 200, { data: { ...result, auto_restart: false }, meta: { registry_revision: result.plan?.registry_revision } });
      }
      if (requestUrl.pathname === '/v2/packages' && req.method === 'GET') {
        const type = requestUrl.searchParams.get('type');
        const packages = (await listPackages({ ...localOptions(options), all: requestUrl.searchParams.get('all') === 'true' }))
          .filter((item) => !type || item.type === normalizePackageType(type));
        return json(req, res, 200, { data: { packages }, meta: {} });
      }
      if (requestUrl.pathname === '/v2/packages/action' && req.method === 'POST') {
        const request = await body(req); requireApproval(request);
        const action = String(request.action || '');
        if (!request.spec) throw new Error('package action requires spec');
        const local = localOptions(options, request);
        let result;
        if (action === 'update') result = await updatePackageRequest(request.spec, local);
        else if (action === 'remove') result = await removePackageRequest(request.spec, local);
        else if (action === 'rollback') result = await rollbackPackageRequest(request.spec, local);
        else if (action === 'enable') result = await setPackageEnabled(request.spec, true, local);
        else if (action === 'disable') result = await setPackageEnabled(request.spec, false, local);
        else if (action === 'verify') result = await verifyPackageRequest(request.spec, local);
        else throw new Error(`unsupported package action: ${action}`);
        return json(req, res, 200, { data: { ...result, auto_restart: false }, meta: {} });
      }

      const route = packageRoute(requestUrl.pathname);
      if (route && !route.action && req.method === 'GET') {
        const coordinate = coordinateFromRoute(route.type, route.id);
        return json(req, res, 200, { data: { package: await packageInfo(coordinate, localOptions(options)) }, meta: {} });
      }
      if (route?.action === 'verify' && req.method === 'POST') {
        const request = await body(req); requireApproval(request);
        return json(req, res, 200, { data: await verifyPackageRequest(coordinateFromRoute(route.type, route.id), localOptions(options, request)), meta: {} });
      }
      if (route?.action === 'config' && req.method === 'GET') {
        const id = decodeURIComponent(route.id);
        return json(req, res, 200, { data: { type: route.type, id, config: redactConfig(await readPackageConfig(route.type, id)) }, meta: {} });
      }
      if (route?.action === 'config' && req.method === 'PATCH') {
        const request = await body(req); requireApproval(request);
        if (!request.key) throw new Error('config key is required');
        const id = decodeURIComponent(route.id);
        const result = request.unset === true
          ? await unsetPackageConfig(route.type, id, request.key)
          : request.value === undefined ? null : await setPackageConfig(route.type, id, request.key, typeof request.value === 'string' ? request.value : JSON.stringify(request.value));
        if (!result) throw new Error('config value is required unless unset=true');
        return json(req, res, 200, { data: { ...result, config: redactConfig(result.config) }, meta: {} });
      }

      const secret = secretRoute(requestUrl.pathname);
      if (secret && !secret.name && req.method === 'GET') return json(req, res, 200, { data: { secrets: await listSecrets() }, meta: {} });
      if (secret?.name && (req.method === 'PUT' || req.method === 'POST')) {
        const request = await body(req); requireApproval(request);
        if (request.value === undefined || request.value === null || request.value === '') throw new Error('secret value is required');
        const result = await setSecret(secret.name, request.value);
        return json(req, res, 200, { data: { ...result, value: '<secret>' }, meta: {} });
      }
      if (secret?.name && req.method === 'DELETE') {
        const request = await body(req); requireApproval(request);
        return json(req, res, 200, { data: await deleteSecret(secret.name), meta: {} });
      }
      if (secret?.name && req.method === 'GET') return json(req, res, 405, { error: { code: 'DSH_SECRET_READ_FORBIDDEN', message: 'secret values are never returned by the local HTTP API' }, meta: {} });

      return json(req, res, 404, { error: { code: 'DSH_NOT_FOUND', message: 'not found' }, meta: {} });
    } catch (error) {
      const status = errorStatus(error);
      return json(req, res, status, { error: { code: error.code || 'DSH_CLIENT_HOST_ERROR', message: error.message }, meta: { confirmation_required: status === 409 && (error.code === 'DSH_APPROVAL_REQUIRED' || error.code === 'DSH_PERMISSION_DENIED') } });
    }
  });
  return { server, token, host, port };
}

export async function startClientHost(options = {}) {
  const host = await createClientHost(options);
  await new Promise((accept, reject) => {
    host.server.once('error', reject);
    host.server.listen(host.port, host.host, accept);
  });
  const address = host.server.address();
  if (address && typeof address === 'object') host.port = address.port;
  return host;
}
