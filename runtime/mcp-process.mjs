import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { mcpStatus, startMcp } from './execution.mjs';
import { safePackageId } from './package-model.mjs';
import { runtimeRoot } from './registry.mjs';

const execFileAsync = promisify(execFile);
const DEFAULT_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_STOP_POLL_MS = 50;
const DEFAULT_START_TIME_TOLERANCE_MS = 10_000;

function executionRoot() {
  return resolve(process.env.DSH_EXECUTION_HOME || join(runtimeRoot(), 'run'));
}

export function mcpStatePath(id) {
  return join(executionRoot(), 'mcp', `${safePackageId(id)}.json`);
}

export function processRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseStartedAt(value) {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? timestamp : null;
}

async function defaultProcessStartTime(pid, platform = process.platform) {
  if (platform === 'win32') {
    const script = [
      `$p = Get-Process -Id ${pid} -ErrorAction Stop`,
      '$p.StartTime.ToUniversalTime().ToString("o")',
    ].join('; ');
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5_000,
    });
    return stdout.trim() || null;
  }

  const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'lstart='], {
    encoding: 'utf8',
    timeout: 3_000,
    env: { ...process.env, LC_ALL: 'C' },
  });
  return stdout.trim() || null;
}

export async function readProcessStartTime(pid, options = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const raw = await defaultProcessStartTime(pid, options.platform || process.platform);
    if (!raw) return null;
    const timestamp = parseStartedAt(raw);
    if (timestamp === null) throw new Error(`unparseable process start time: ${raw}`);
    return new Date(timestamp).toISOString();
  } catch (cause) {
    if (!processRunning(pid)) return null;
    const error = new Error(`cannot verify MCP process identity for pid ${pid}`);
    error.code = 'DSH_PROCESS_IDENTITY_UNAVAILABLE';
    error.pid = pid;
    error.state_preserved = true;
    error.cause = cause;
    throw error;
  }
}

export async function verifyManagedProcessIdentity(state, options = {}) {
  if (!state?.managed_process) return { matched: true, verified: false, managed_process: false };
  const pid = Number(state.pid);
  if (!Number.isInteger(pid) || pid <= 0) {
    return { matched: false, verified: false, invalid: true, pid };
  }
  const expected = parseStartedAt(state.started_at);
  if (expected === null) {
    return { matched: true, verified: false, legacy: true, pid };
  }

  const reader = options.getProcessStartTime || readProcessStartTime;
  const observedRaw = await reader(pid, options);
  if (!observedRaw) return { matched: false, verified: false, exited: true, pid };
  const observed = parseStartedAt(observedRaw);
  if (observed === null) {
    const error = new Error(`cannot parse MCP process identity for pid ${pid}`);
    error.code = 'DSH_PROCESS_IDENTITY_INVALID';
    error.pid = pid;
    error.state_preserved = true;
    throw error;
  }

  const toleranceMs = Math.max(1, Number(options.startTimeToleranceMs) || DEFAULT_START_TIME_TOLERANCE_MS);
  const deltaMs = observed - expected;
  return {
    matched: Math.abs(deltaMs) <= toleranceMs,
    verified: true,
    pid,
    expected_started_at: new Date(expected).toISOString(),
    observed_started_at: new Date(observed).toISOString(),
    delta_ms: deltaMs,
    tolerance_ms: toleranceMs,
  };
}

function identityMismatchError(id, identity) {
  const error = new Error(`MCP process identity mismatch; refusing to signal pid ${identity.pid}: ${id}`);
  error.code = 'DSH_PROCESS_IDENTITY_MISMATCH';
  error.pid = identity.pid;
  error.state_preserved = true;
  error.identity = identity;
  return error;
}

function sleep(ms) {
  return new Promise((accept) => setTimeout(accept, ms));
}

export async function waitForProcessExit(pid, options = {}) {
  const timeoutMs = Math.max(0, Number(options.timeoutMs) || DEFAULT_STOP_TIMEOUT_MS);
  const pollMs = Math.max(1, Number(options.pollMs) || DEFAULT_STOP_POLL_MS);
  const isRunning = options.isRunning || processRunning;
  const pause = options.sleep || sleep;
  const deadline = Date.now() + timeoutMs;

  while (isRunning(pid)) {
    if (Date.now() >= deadline) return false;
    await pause(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  }
  return true;
}

export async function readMcpProcessState(id) {
  const file = mcpStatePath(id);
  try {
    const { readFile } = await import('node:fs/promises');
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function startMcpSafely(id, options = {}) {
  const state = await readMcpProcessState(id);
  if (state?.managed_process) {
    const pid = Number(state.pid);
    const isRunning = options.isRunning || processRunning;
    if (Number.isInteger(pid) && pid > 0 && isRunning(pid)) {
      const identity = await verifyManagedProcessIdentity(state, options);
      if (identity.matched) {
        return {
          ...state,
          running: true,
          already_running: true,
          identity_verified: identity.verified,
          identity_legacy: identity.legacy === true,
        };
      }
      if (!identity.exited) {
        await rm(mcpStatePath(id), { force: true });
      }
    }
  }
  return (options.start || startMcp)(id, options);
}

export async function mcpStatusSafely(id, options = {}) {
  const status = await (options.status || mcpStatus)(id, options);
  const state = status?.state || await readMcpProcessState(id);
  if (!state?.managed_process) return { ...status, identity_verified: false };

  const pid = Number(state.pid);
  const isRunning = options.isRunning || processRunning;
  if (!Number.isInteger(pid) || pid <= 0 || !isRunning(pid)) {
    return { ...status, running: false, identity_verified: false };
  }

  const identity = await verifyManagedProcessIdentity(state, options);
  if (!identity.matched) {
    return {
      ...status,
      running: false,
      stale_state: true,
      pid_reused: !identity.exited,
      identity_verified: identity.verified,
      identity,
    };
  }
  return {
    ...status,
    running: true,
    identity_verified: identity.verified,
    identity_legacy: identity.legacy === true,
  };
}

export async function stopMcpSafely(id, options = {}) {
  const state = await readMcpProcessState(id);
  if (!state) return { type: 'mcp', id, stopped: false, reason: 'not-started' };

  if (!state.managed_process) {
    await rm(mcpStatePath(id), { force: true });
    return { type: 'mcp', id, stopped: true, pid: null, managed_process: false };
  }

  const pid = Number(state.pid);
  const isRunning = options.isRunning || processRunning;
  const signal = options.signal || ((target) => process.kill(target, 'SIGTERM'));
  if (!Number.isInteger(pid) || pid <= 0) {
    const error = new Error(`managed MCP state has an invalid pid: ${id}`);
    error.code = 'DSH_PROCESS_STATE_INVALID';
    error.state_preserved = true;
    throw error;
  }

  let identity = { matched: true, verified: false, legacy: true, pid };
  if (isRunning(pid)) {
    identity = await verifyManagedProcessIdentity(state, options);
    if (!identity.matched && !identity.exited) throw identityMismatchError(id, identity);

    if (!identity.exited && isRunning(pid)) {
      try {
        signal(pid);
      } catch (error) {
        if (isRunning(pid)) throw error;
      }

      let exited = await waitForProcessExit(pid, {
        timeoutMs: Number(options.stopTimeoutMs ?? options.timeoutMs) || DEFAULT_STOP_TIMEOUT_MS,
        pollMs: options.pollMs,
        isRunning,
        sleep: options.sleep,
      });
      if (!exited && state.started_at) {
        const after = await verifyManagedProcessIdentity(state, options);
        if (!after.matched) exited = true;
      }
      if (!exited) {
        const error = new Error(`MCP process did not exit after SIGTERM: ${id} (pid ${pid})`);
        error.code = 'DSH_PROCESS_STOP_TIMEOUT';
        error.pid = pid;
        error.state_preserved = true;
        throw error;
      }
    }
  }

  await rm(mcpStatePath(id), { force: true });
  return {
    type: 'mcp', id, stopped: true, pid, managed_process: true, exit_confirmed: true,
    identity_verified: identity.verified === true,
    identity_legacy: identity.legacy === true,
  };
}

export async function restartMcpSafely(id, options = {}) {
  const stopped = await stopMcpSafely(id, options);
  const starter = options.start || startMcp;
  const started = await starter(id, options);
  return { ...started, restarted: true, previous: stopped };
}
