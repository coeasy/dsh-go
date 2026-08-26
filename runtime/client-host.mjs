import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildInstallDeepLink, deepLinkInstallPlan } from './client-bridge.mjs';

const CLI = fileURLToPath(new URL('./dsh.mjs', import.meta.url));

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

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  if (text.length > 64 * 1024) throw new Error('request body is too large');
  return JSON.parse(text);
}

function json(res, status, payload) {
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

async function executeDeepLink(url) {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, [CLI, 'bridge', 'handle', url, '--yes'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? accept({ success: true, stdout, stderr }) : reject(new Error(stderr || stdout || `dsh exited ${code}`)));
  });
}

export async function createClientHost(options = {}) {
  const token = options.token || await ensureBridgeToken(options.tokenFile);
  const host = options.host || '127.0.0.1';
  const port = Number(options.port || process.env.DSH_BRIDGE_PORT || 43731);
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/health' && req.method === 'GET') return json(res, 200, { ok: true, service: 'dsh-client-host', protocol: 1 });
      if (!authenticated(req, token)) return json(res, 401, { error: 'unauthorized' });
      if (req.url === '/v1/install/plan' && req.method === 'POST') {
        const request = await body(req);
        const url = request.url || buildInstallDeepLink(request);
        return json(res, 200, deepLinkInstallPlan(url));
      }
      if (req.url === '/v1/install/execute' && req.method === 'POST') {
        const request = await body(req);
        if (request.approved !== true) return json(res, 409, { error: 'explicit approval required', confirmation_required: true });
        const url = request.url || buildInstallDeepLink(request);
        const result = await executeDeepLink(url);
        return json(res, 200, { ...result, restart_required: true, auto_restart: false });
      }
      return json(res, 404, { error: 'not found' });
    } catch (error) {
      return json(res, 400, { error: error.message });
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
  return host;
}
