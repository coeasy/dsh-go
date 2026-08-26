import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildInstallDeepLink, deepLinkInstallPlan } from './client-bridge.mjs';
import { assertPackageType } from './package-model.mjs';
import { getRuntimePackage, readRuntimeRegistry } from './registry.mjs';
import { readPackageConfig, redactConfig, setPackageConfig, unsetPackageConfig } from './config-store.mjs';
import { deleteSecret, listSecrets, setSecret } from './secret-store.mjs';

const CLI = fileURLToPath(new URL('../bin/dsh.mjs', import.meta.url));
const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_ALLOWED_ORIGINS = new Set([
  'https://coeasy.github.io',
  'https://dsh-go.pages.dev',
]);

export function bridgeTokenFile() {
  return process.env.DSH_BRIDGE_TOKEN_FILE || join(homedir(), '.dsh', 'bridge-token');
}

export async function ensureBridgeToken(file = bridgeTokenFile()) {
  try {
    const value = (await readFile(resolve(file), 'utf8')).trim();
    if (value.length >= 32) return value;
  } catch { /* create below */ }
  const target = resolve(file);
  await mkdir(dirname(target), { recursive: true });
  const value = randomBytes(32).toString('hex');
  await writeFile(target, `${value}\n`, { encoding: 'utf8', mode: 0o600 });
  try { await chmod(target, 0o600); } catch { /* Windows ACLs are managed by the OS */ }
  return value;
}

function authenticated(req, token) {
  const raw = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!raw || raw.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(raw), Buffer.from(token));
}

function allowedOrigin(origin) {
  if (!origin) return null;
  const configured = String(process.env.DSH_BRIDGE_ALLOWED_ORIGINS || '')
    .split(',').map((value) => value.trim()).filter(Boolean);
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
    if (bytes > MAX_BODY_BYTES) throw new Error('request body is too large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  return JSON.parse(text);
}

function responseHeaders(req, extra = {}) {
  const origin = allowedOrigin(String(req.headers.origin || ''));
  return {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-dsh-api-version': 'v1',
    'x-content-type-options': 'nosniff',
    ...(origin ? {
      'access-control-allow-origin': origin,
      vary: 'Origin',
    } : {}),
    ...extra,
  };
}

function json(req, res, status, payload) {
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  res.writeHead(status, { ...responseHeaders(req), 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function parseCliJson(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function executeCli(argv) {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, [CLI, ...argv], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0
      ? accept({ success: true, result: parseCliJson(stdout), stdout, stderr })
      : reject(new Error(stderr || stdout || `dsh exited ${code}`)));
  });
}

async function executeDeepLink(url) {
  return executeCli(['host', 'handle', url, '--yes']);
}

function packageRoute(pathname) {
  const match = pathname.match(/^\/v1\/packages\/(plugin|mcp|skill|agent)\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) return null;
  return { type: assertPackageType(match[1]), id: decodeURIComponent(match[2]), action: match[3] || null };
}

function secretRoute(pathname) {
  const match = pathname.match(/^\/v1\/secrets(?:\/([^/]+))?$/);
  if (!match) return null;
  return { name: match[1] ? decodeURIComponent(match[1]) : null };
}

function requireApproval(request) {
  if (request.approved !== true) {
    const error = new Error('explicit approval required');
    error.code = 'DSH_APPROVAL_REQUIRED';
    throw error;
  }
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
        if (!origin) return json(req, res, 403, { error: 'origin not allowed' });
        res.writeHead(204, responseHeaders(req, {
          'access-control-allow-origin': origin,
          'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'access-control-allow-headers': 'Authorization, Content-Type',
          'access-control-max-age': '600',
        }));
        return res.end();
      }
      if (requestUrl.pathname === '/health' && req.method === 'GET') {
        return json(req, res, 200, { ok: true, service: 'dsh-client-host', protocol: 1, version: '0.1.0', api: '/v1' });
      }
      if (!authenticated(req, token)) return json(req, res, 401, { error: 'unauthorized' });

      if (requestUrl.pathname === '/v1/install/plan' && req.method === 'POST') {
        const request = await body(req);
        const url = request.url || buildInstallDeepLink(request);
        return json(req, res, 200, deepLinkInstallPlan(url));
      }
      if (requestUrl.pathname === '/v1/install/execute' && req.method === 'POST') {
        const request = await body(req);
        requireApproval(request);
        const url = request.url || buildInstallDeepLink(request);
        const result = await executeDeepLink(url);
        return json(req, res, 200, { ...result, restart_required: true, auto_restart: false });
      }
      if (requestUrl.pathname === '/v1/packages' && req.method === 'GET') {
        const registry = await readRuntimeRegistry();
        const includeRemoved = requestUrl.searchParams.get('all') === 'true';
        const type = requestUrl.searchParams.get('type');
        const packages = registry.packages
          .filter((record) => includeRemoved || record.state !== 'removed')
          .filter((record) => !type || record.type === type);
        return json(req, res, 200, { packages, generation: registry.generation });
      }

      const secrets = secretRoute(requestUrl.pathname);
      if (secrets && req.method === 'GET' && !secrets.name) {
        return json(req, res, 200, { secrets: await listSecrets() });
      }
      if (secrets?.name && (req.method === 'PUT' || req.method === 'POST')) {
        const request = await body(req);
        requireApproval(request);
        if (request.value === undefined || request.value === null || request.value === '') return json(req, res, 400, { error: 'secret value is required' });
        const result = await setSecret(secrets.name, request.value);
        return json(req, res, 200, { ...result, value: '<secret>' });
      }
      if (secrets?.name && req.method === 'DELETE') {
        const request = await body(req);
        requireApproval(request);
        return json(req, res, 200, await deleteSecret(secrets.name));
      }
      if (secrets?.name && req.method === 'GET') {
        return json(req, res, 405, { error: 'secret values are never returned by the local HTTP API; use the local CLI with an explicit --show if required' });
      }

      const route = packageRoute(requestUrl.pathname);
      if (route && req.method === 'GET' && !route.action) {
        const registry = await readRuntimeRegistry();
        const record = getRuntimePackage(registry, route.type, route.id, { includeRemoved: requestUrl.searchParams.get('all') === 'true' });
        if (!record) return json(req, res, 404, { error: 'package not found', type: route.type, id: route.id });
        return json(req, res, 200, { package: record });
      }
      if (route && req.method === 'GET' && route.action === 'config') {
        return json(req, res, 200, { type: route.type, id: route.id, config: redactConfig(await readPackageConfig(route.type, route.id)) });
      }
      if (route && req.method === 'PATCH' && route.action === 'config') {
        const request = await body(req);
        requireApproval(request);
        if (!request.key) return json(req, res, 400, { error: 'config key is required' });
        const result = request.unset === true
          ? await unsetPackageConfig(route.type, route.id, request.key)
          : request.value === undefined
            ? null
            : await setPackageConfig(route.type, route.id, request.key, typeof request.value === 'string' ? request.value : JSON.stringify(request.value));
        if (!result) return json(req, res, 400, { error: 'config value is required unless unset=true' });
        return json(req, res, 200, { ...result, config: redactConfig(result.config) });
      }
      if (route && req.method === 'GET' && route.action === 'logs' && route.type === 'mcp') {
        const result = await executeCli(['mcp', 'logs', route.id]);
        return json(req, res, 200, result);
      }
      if (route && req.method === 'DELETE' && !route.action) {
        const request = await body(req);
        requireApproval(request);
        const argv = [route.type, 'remove', route.id, '--yes'];
        if (request.cascade === true) argv.push('--cascade');
        const result = await executeCli(argv);
        return json(req, res, 200, { ...result, restart_required: true, auto_restart: false });
      }
      if (route && req.method === 'PATCH' && !route.action) {
        const request = await body(req);
        const action = String(request.action || '');
        const allowed = new Set(['update', 'repair', 'rollback', 'enable', 'disable']);
        if (!allowed.has(action)) return json(req, res, 400, { error: `unsupported package action: ${action}` });
        requireApproval(request);
        const argv = [route.type, action, route.id];
        if (request.version) argv.push(String(request.version));
        argv.push('--yes');
        const result = await executeCli(argv);
        return json(req, res, 200, { ...result, restart_required: true, auto_restart: false });
      }
      if (route && req.method === 'POST' && route.action) {
        const request = await body(req);
        const allowed = route.type === 'mcp'
          ? new Set(['start', 'stop', 'restart', 'probe', 'invoke'])
          : route.type === 'skill'
            ? new Set(['load', 'unload', 'invoke'])
            : new Set();
        if (!allowed.has(route.action)) return json(req, res, 400, { error: `unsupported runtime action: ${route.action}` });
        requireApproval(request);
        const argv = [route.type, route.action, route.id];
        if (route.action === 'invoke' && route.type === 'mcp') {
          if (!request.tool) return json(req, res, 400, { error: 'tool is required' });
          argv.push(String(request.tool));
        }
        if (request.input !== undefined) argv.push('--input', JSON.stringify(request.input));
        const result = await executeCli(argv);
        return json(req, res, 200, result);
      }

      return json(req, res, 404, { error: 'not found' });
    } catch (error) {
      const status = error.code === 'DSH_APPROVAL_REQUIRED' ? 409 : 400;
      return json(req, res, status, { error: error.message, confirmation_required: status === 409 });
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
