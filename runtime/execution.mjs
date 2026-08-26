import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join, resolve, sep } from 'node:path';
import { readPackageConfig, resolveConfigSecrets } from './config-store.mjs';
import { getSecret } from './secret-store.mjs';
import { assertResourcePolicy } from './permission-policy.mjs';
import { assertPackageType, packageKey, safePackageId } from './package-model.mjs';
import { getRuntimePackage, readRuntimeRegistry, runtimeRoot } from './registry.mjs';
import { buildExecutionEnv } from './execution-env.mjs';

const DEFAULT_TIMEOUT_MS = 30_000;

function executionRoot() {
  return resolve(process.env.DSH_EXECUTION_HOME || join(runtimeRoot(), 'run'));
}

function statePath(type, id) {
  return join(executionRoot(), assertPackageType(type), `${safePackageId(id)}.json`);
}

function logPath(type, id) {
  return join(executionRoot(), assertPackageType(type), `${safePackageId(id)}.log`);
}

async function writeState(type, id, value) {
  const file = statePath(type, id);
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temp, file);
  return value;
}

export async function readExecutionState(type, id) {
  try { return JSON.parse(await readFile(statePath(type, id), 'utf8')); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function pidRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function runtimeRecord(type, id, options = {}) {
  const normalizedType = assertPackageType(type);
  const registry = await readRuntimeRegistry(options.registryFile);
  const record = getRuntimePackage(registry, normalizedType, id);
  if (!record) throw new Error(`runtime package is not installed: ${packageKey(normalizedType, id)}`);
  if (record.enabled === false || record.state === 'disabled') throw new Error(`runtime package is disabled: ${packageKey(normalizedType, id)}`);
  if (record.restart_required || !record.activated || record.state !== 'active' || !record.binding) {
    throw new Error(`runtime package is not active; restart the client and run startup activation first: ${packageKey(normalizedType, id)}`);
  }
  return record;
}

function declaredPermissions(record) {
  return new Set([
    ...(Array.isArray(record.permissions) ? record.permissions : []),
    ...(Array.isArray(record.binding?.declared_permissions) ? record.binding.declared_permissions : []),
  ].map(String));
}

function requireDeclared(record, permission, alternatives = []) {
  const declared = declaredPermissions(record);
  const allowed = declared.has(permission) || alternatives.some((candidate) => declared.has(candidate));
  if (!allowed) {
    const error = new Error(`runtime execution requires declared permission ${permission}: ${packageKey(record.type, record.id)}`);
    error.code = 'DSH_PERMISSION_NOT_DECLARED';
    error.permission = permission;
    throw error;
  }
}

function policy(record) {
  return record.binding?.permission_policy || record.permission_policy || null;
}

function inside(root, path) {
  const base = resolve(root);
  const candidate = resolve(base, path);
  return candidate === base || candidate.startsWith(`${base}${sep}`) ? candidate : null;
}

async function resolvedConfig(record, type, id) {
  const config = await readPackageConfig(type, id);
  return resolveConfigSecrets(config, async (name) => {
    requireDeclared(record, 'secrets.read');
    assertResourcePolicy(policy(record), 'secrets.read', name);
    return getSecret(name);
  });
}

function mcpDescriptor(record, config) {
  const manifestConfig = record.binding?.manifest?.mcp || {};
  const transportConfig = record.binding?.transport_config || {};
  const merged = { ...transportConfig, ...manifestConfig, ...(config.mcp || config) };
  const transport = merged.transport || 'stdio';
  return {
    transport,
    command: merged.command,
    args: Array.isArray(merged.args) ? merged.args.map(String) : [],
    url: merged.url,
    env: merged.env && typeof merged.env === 'object' ? merged.env : {},
    headers: merged.headers && typeof merged.headers === 'object' ? merged.headers : {},
  };
}

function assertProcessExecution(record, command) {
  requireDeclared(record, 'process.spawn');
  return assertResourcePolicy(policy(record), 'process.spawn', String(command));
}

function assertNetworkExecution(record, url) {
  requireDeclared(record, 'network', ['network.unrestricted']);
  const parsed = new URL(String(url));
  assertResourcePolicy(policy(record), 'network', parsed.hostname);
  return parsed;
}

async function waitSpawn(child) {
  await new Promise((accept, reject) => {
    child.once('spawn', accept);
    child.once('error', reject);
  });
}

export async function startMcp(id, options = {}) {
  const record = await runtimeRecord('mcp', id, options);
  const config = await resolvedConfig(record, 'mcp', id);
  const descriptor = mcpDescriptor(record, config);
  const previous = await readExecutionState('mcp', id);
  if (previous?.pid && pidRunning(previous.pid)) return { ...previous, running: true, already_running: true };

  if (descriptor.transport !== 'stdio') {
    if (!descriptor.url) throw new Error(`mcp ${descriptor.transport} transport requires url`);
    assertNetworkExecution(record, descriptor.url);
    const state = await writeState('mcp', id, {
      type: 'mcp', id, transport: descriptor.transport, url: descriptor.url,
      running: true, managed_process: false, started_at: new Date().toISOString(),
    });
    return state;
  }
  if (!descriptor.command) throw new Error('mcp stdio transport requires command');
  assertProcessExecution(record, descriptor.command);

  const log = logPath('mcp', id);
  await mkdir(dirname(log), { recursive: true });
  const handle = await open(log, 'a', 0o600);
  let child;
  try {
    child = spawn(String(descriptor.command), descriptor.args, {
      cwd: record.path,
      env: buildExecutionEnv(descriptor.env),
      stdio: ['ignore', handle.fd, handle.fd],
      detached: true,
      windowsHide: true,
    });
    await waitSpawn(child);
    child.unref();
  } finally {
    await handle.close();
  }
  return writeState('mcp', id, {
    type: 'mcp', id, transport: 'stdio', pid: child.pid, running: true, managed_process: true,
    command: descriptor.command, args: descriptor.args, log, started_at: new Date().toISOString(),
  });
}

export async function stopMcp(id, options = {}) {
  await runtimeRecord('mcp', id, options);
  const state = await readExecutionState('mcp', id);
  if (!state) return { type: 'mcp', id, stopped: false, reason: 'not-started' };
  if (state.managed_process && state.pid && pidRunning(state.pid)) {
    try { process.kill(state.pid, 'SIGTERM'); } catch { /* process exited between checks */ }
  }
  await rm(statePath('mcp', id), { force: true });
  return { type: 'mcp', id, stopped: true, pid: state.pid || null };
}

export async function restartMcp(id, options = {}) {
  await stopMcp(id, options);
  return startMcp(id, options);
}

export async function mcpStatus(id, options = {}) {
  const record = await runtimeRecord('mcp', id, options);
  const state = await readExecutionState('mcp', id);
  return {
    type: 'mcp', id, active: true, transport: state?.transport || record.binding?.transport_config?.transport || record.binding?.manifest?.mcp?.transport || 'stdio',
    running: state?.managed_process ? pidRunning(state.pid) : Boolean(state?.running),
    pid: state?.pid || null, state,
  };
}

export async function readMcpLogs(id, options = {}) {
  await runtimeRecord('mcp', id, options);
  const file = logPath('mcp', id);
  const maxBytes = Math.max(1024, Math.min(Number(options.maxBytes) || 64 * 1024, 1024 * 1024));
  try {
    const info = await stat(file);
    const start = Math.max(0, info.size - maxBytes);
    const handle = await open(file, 'r');
    try {
      const buffer = Buffer.alloc(info.size - start);
      await handle.read(buffer, 0, buffer.length, start);
      return { type: 'mcp', id, file, text: buffer.toString('utf8') };
    } finally { await handle.close(); }
  } catch (error) {
    if (error?.code === 'ENOENT') return { type: 'mcp', id, file, text: '' };
    throw error;
  }
}

function parseJsonOrSse(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch { /* parse SSE below */ }
  const data = trimmed.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).filter(Boolean);
  for (const value of data.reverse()) {
    try { return JSON.parse(value); } catch { /* keep searching */ }
  }
  throw new Error('MCP response is not valid JSON or SSE JSON data');
}

async function remoteMcpRequest(url, payload, descriptor, sessionId, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...Object.fromEntries(Object.entries(descriptor.headers || {}).map(([key, value]) => [key, String(value)])),
    };
    if (sessionId) headers['mcp-session-id'] = sessionId;
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`MCP HTTP ${response.status}: ${text.slice(0, 500)}`);
    return { data: parseJsonOrSse(text), sessionId: response.headers.get('mcp-session-id') || sessionId };
  } finally { clearTimeout(timer); }
}

async function invokeRemoteMcp(record, descriptor, tool, input, timeoutMs) {
  if (!descriptor.url) throw new Error('remote MCP transport requires url');
  assertNetworkExecution(record, descriptor.url);
  let sessionId;
  const initialized = await remoteMcpRequest(descriptor.url, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'dsh-go', version: '0.1.0' } },
  }, descriptor, sessionId, timeoutMs);
  sessionId = initialized.sessionId;
  await remoteMcpRequest(descriptor.url, { jsonrpc: '2.0', method: 'notifications/initialized' }, descriptor, sessionId, timeoutMs);
  const result = await remoteMcpRequest(descriptor.url, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: input || {} } }, descriptor, sessionId, timeoutMs);
  return result.data;
}

async function waitForRpc(pending, id, timeoutMs, stderr) {
  return new Promise((accept, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`MCP stdio request timed out${stderr.value ? `: ${stderr.value.slice(-500)}` : ''}`));
    }, timeoutMs);
    pending.set(id, (message) => {
      clearTimeout(timer);
      if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
      else accept(message.result);
    });
  });
}

async function invokeStdioMcp(record, descriptor, tool, input, timeoutMs) {
  if (!descriptor.command) throw new Error('mcp stdio transport requires command');
  assertProcessExecution(record, descriptor.command);
  const child = spawn(String(descriptor.command), descriptor.args, {
    cwd: record.path,
    env: buildExecutionEnv(descriptor.env),
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  await waitSpawn(child);
  const pending = new Map();
  const stderr = { value: '' };
  child.stderr.on('data', (chunk) => { stderr.value = `${stderr.value}${chunk}`.slice(-4096); });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    try {
      const message = JSON.parse(line);
      if (message?.id !== undefined && pending.has(message.id)) {
        const handler = pending.get(message.id);
        pending.delete(message.id);
        handler(message);
      }
    } catch { /* ignore non-protocol stdout */ }
  });
  const send = (payload) => child.stdin.write(`${JSON.stringify(payload)}\n`);
  try {
    const initPromise = waitForRpc(pending, 1, timeoutMs, stderr);
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'dsh-go', version: '0.1.0' } } });
    await initPromise;
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const callPromise = waitForRpc(pending, 2, timeoutMs, stderr);
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: input || {} } });
    return await callPromise;
  } finally {
    lines.close();
    child.stdin.end();
    if (!child.killed) child.kill();
  }
}

export async function invokeMcp(id, tool, input = {}, options = {}) {
  if (!tool) throw new Error('MCP tool name is required');
  const record = await runtimeRecord('mcp', id, options);
  const config = await resolvedConfig(record, 'mcp', id);
  const descriptor = mcpDescriptor(record, config);
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const result = descriptor.transport === 'stdio'
    ? await invokeStdioMcp(record, descriptor, tool, input, timeoutMs)
    : await invokeRemoteMcp(record, descriptor, tool, input, timeoutMs);
  return { type: 'mcp', id, tool, result };
}

export async function probeMcp(id, options = {}) {
  const record = await runtimeRecord('mcp', id, options);
  const config = await resolvedConfig(record, 'mcp', id);
  const descriptor = mcpDescriptor(record, config);
  if (descriptor.transport === 'stdio') return mcpStatus(id, options);
  assertNetworkExecution(record, descriptor.url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs) || 5000);
  try {
    const response = await fetch(descriptor.url, { method: 'GET', headers: descriptor.headers, signal: controller.signal });
    return { type: 'mcp', id, transport: descriptor.transport, url: descriptor.url, reachable: response.ok || response.status === 405, status: response.status };
  } catch (error) {
    return { type: 'mcp', id, transport: descriptor.transport, url: descriptor.url, reachable: false, error: error.message };
  } finally { clearTimeout(timer); }
}

function skillDescriptor(record, config) {
  const manifestConfig = record.binding?.manifest?.skill || {};
  const merged = { ...manifestConfig, ...(config.skill || config) };
  return {
    executor: String(merged.executor || record.binding?.executor || 'node').toLowerCase(),
    entrypoint: merged.entrypoint || record.binding?.entrypoint,
    args: Array.isArray(merged.args) ? merged.args.map(String) : [],
    env: merged.env && typeof merged.env === 'object' ? merged.env : {},
  };
}

export async function inspectSkill(id, options = {}) {
  const record = await runtimeRecord('skill', id, options);
  const config = await resolvedConfig(record, 'skill', id);
  return { type: 'skill', id, binding: record.binding, config, state: await readExecutionState('skill', id) };
}

export async function loadSkill(id, options = {}) {
  const record = await runtimeRecord('skill', id, options);
  const config = await resolvedConfig(record, 'skill', id);
  const descriptor = skillDescriptor(record, config);
  if (!descriptor.entrypoint) throw new Error('skill entrypoint is required');
  const path = inside(record.path, descriptor.entrypoint);
  if (!path) throw new Error('skill entrypoint escapes package root');
  const state = await writeState('skill', id, { type: 'skill', id, loaded: true, entrypoint: path, loaded_at: new Date().toISOString() });
  return { type: 'skill', id, binding: record.binding, state };
}

export async function unloadSkill(id, options = {}) {
  await runtimeRecord('skill', id, options);
  await rm(statePath('skill', id), { force: true });
  return { type: 'skill', id, loaded: false };
}

async function runExecutable(command, args, record, descriptor, input, timeoutMs) {
  assertProcessExecution(record, command);
  const child = spawn(command, args, {
    cwd: record.path,
    env: buildExecutionEnv(descriptor.env),
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  await waitSpawn(child);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  let timer;
  const completed = new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? accept(code) : reject(new Error(stderr || `executor exited ${code ?? signal}`)));
  });
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (!child.killed) child.kill();
      reject(new Error('executor timed out'));
    }, timeoutMs);
  });
  child.stdin.end(`${JSON.stringify(input ?? {})}\n`);
  try {
    await Promise.race([completed, timeout]);
  } finally {
    clearTimeout(timer);
  }
  const trimmed = stdout.trim();
  let output = trimmed;
  if (trimmed) { try { output = JSON.parse(trimmed); } catch { /* text output */ } }
  return { output, stdout, stderr };
}

export async function invokeSkill(id, input = {}, options = {}) {
  const record = await runtimeRecord('skill', id, options);
  const config = await resolvedConfig(record, 'skill', id);
  const descriptor = skillDescriptor(record, config);
  if (!descriptor.entrypoint) throw new Error('skill entrypoint is required');
  const entrypoint = inside(record.path, descriptor.entrypoint);
  if (!entrypoint) throw new Error('skill entrypoint escapes package root');
  let command;
  let args;
  if (descriptor.executor === 'node') {
    command = process.execPath;
    args = [entrypoint, ...descriptor.args];
  } else if (descriptor.executor === 'python' || descriptor.executor === 'python3') {
    command = descriptor.executor;
    args = [entrypoint, ...descriptor.args];
  } else {
    throw new Error(`unsupported skill executor: ${descriptor.executor}`);
  }
  const result = await runExecutable(command, args, record, descriptor, input, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  await writeState('skill', id, { type: 'skill', id, loaded: true, entrypoint, last_invoked_at: new Date().toISOString() });
  return { type: 'skill', id, executor: descriptor.executor, ...result };
}
