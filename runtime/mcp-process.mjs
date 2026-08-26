import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startMcp } from './execution.mjs';
import { safePackageId } from './package-model.mjs';
import { runtimeRoot } from './registry.mjs';

const DEFAULT_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_STOP_POLL_MS = 50;

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

  if (isRunning(pid)) {
    try {
      signal(pid);
    } catch (error) {
      if (isRunning(pid)) throw error;
    }

    const exited = await waitForProcessExit(pid, {
      timeoutMs: Number(options.stopTimeoutMs ?? options.timeoutMs) || DEFAULT_STOP_TIMEOUT_MS,
      pollMs: options.pollMs,
      isRunning,
      sleep: options.sleep,
    });
    if (!exited) {
      const error = new Error(`MCP process did not exit after SIGTERM: ${id} (pid ${pid})`);
      error.code = 'DSH_PROCESS_STOP_TIMEOUT';
      error.pid = pid;
      error.state_preserved = true;
      throw error;
    }
  }

  await rm(mcpStatePath(id), { force: true });
  return { type: 'mcp', id, stopped: true, pid, managed_process: true, exit_confirmed: true };
}

export async function restartMcpSafely(id, options = {}) {
  const stopped = await stopMcpSafely(id, options);
  const starter = options.start || startMcp;
  const started = await starter(id, options);
  return { ...started, restarted: true, previous: stopped };
}
