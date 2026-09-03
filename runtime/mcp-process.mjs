import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { getLocalMcpProcessStartTime, mcpStatus, startMcp } from './execution.mjs';
import { safePackageId } from './package-model.mjs';
import { runtimeRoot } from './registry.mjs';

const execFileAsync = promisify(execFile);
const DEFAULT_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_STOP_POLL_MS = 50;
const DEFAULT_START_TIME_TOLERANCE_MS = 10_000;
const SUPERVISOR_START_TIME_TOLERANCE_MS = 1_500;
const SUPERVISOR_IDENTITY_VERSION = 1;

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

export function parseWindowsWmicCreationDate(value) {
  const match = String(value || '').match(/CreationDate=(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.(\d{1,6})([+-])(\d{3})/i);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, micros, sign, offset] = match;
  const milliseconds = Number(micros.padEnd(6, '0').slice(0, 3));
  const local = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), milliseconds);
  const offsetMinutes = Number(offset) * (sign === '+' ? 1 : -1);
  const timestamp = local - offsetMinutes * 60_000;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

/**
 * Linux exposes a stable process start tick in /proc/<pid>/stat. The comm
 * field is parenthesized and may itself contain spaces or closing parens, so
 * split only after the final closing paren. Field 22 is the twentieth field
 * after state (field 3). `btime` converts the boot-relative tick to epoch.
 */
export function parseLinuxProcStartTime(statValue, procStatValue, clockTicks = 100) {
  const stat = String(statValue || '');
  const closingParen = stat.lastIndexOf(')');
  if (closingParen < 0) return null;
  const fields = stat.slice(closingParen + 1).trim().split(/\s+/);
  const startTicks = Number(fields[19]);
  const bootSeconds = Number(String(procStatValue || '').match(/(?:^|\n)btime\s+(\d+)/m)?.[1]);
  const hz = Number(clockTicks);
  if (!Number.isFinite(startTicks) || !Number.isFinite(bootSeconds) || !Number.isFinite(hz) || hz <= 0) return null;
  const timestamp = (bootSeconds + startTicks / hz) * 1_000;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

async function linuxProcessStartTime(pid, options = {}) {
  const readProcFile = options.readProcFile || readFile;
  const [statValue, procStatValue] = await Promise.all([
    readProcFile(`/proc/${pid}/stat`, 'utf8'),
    readProcFile('/proc/stat', 'utf8'),
  ]);
  return parseLinuxProcStartTime(statValue, procStatValue, options.procClockTicks || 100);
}

async function windowsProcessStartTime(pid) {
  const windir = process.env.WINDIR || 'C:\\Windows';
  const wmic = join(windir, 'System32', 'wbem', 'WMIC.exe');
  try {
    const { stdout } = await execFileAsync(wmic, ['process', 'where', `ProcessId=${pid}`, 'get', 'CreationDate', '/value'], {
      encoding: 'utf8', windowsHide: true, timeout: 3_000,
    });
    const parsed = parseWindowsWmicCreationDate(stdout);
    if (parsed) return parsed;
  } catch {
    // WMIC is optional on newer Windows images. Fall through to PowerShell.
  }

  const script = [
    `$p = Get-Process -Id ${pid} -ErrorAction Stop`,
    '$p.StartTime.ToUniversalTime().ToString("o")',
  ].join('; ');
  try {
    const { stdout } = await execFileAsync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', windowsHide: true, timeout: 5_000,
    });
    return stdout.trim() || null;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', windowsHide: true, timeout: 5_000,
  });
  return stdout.trim() || null;
}

async function defaultProcessStartTime(pid, platform = process.platform) {
  if (platform === 'win32') return windowsProcessStartTime(pid);

  // Some minimal/container images ship a procps `ps` that fails while
  // looking up its own process. Prefer the kernel-backed Linux source so
  // managed-process stop/status never fails closed merely because `ps` is
  // unavailable or broken.
  if (platform === 'linux') {
    try {
      const procValue = await linuxProcessStartTime(pid);
      if (procValue) return procValue;
    } catch {
      // Continue to ps and the in-process ChildProcess identity fallback.
    }
  }

  try {
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'lstart='], {
      encoding: 'utf8',
      timeout: 3_000,
      env: { PATH: process.env.PATH || '', LC_ALL: 'C' },
    });
    return stdout.trim() || null;
  } catch (cause) {
    const localStart = getLocalMcpProcessStartTime(pid);
    if (localStart) return localStart;
    throw cause;
  }
}

export async function readProcessStartTime(pid, options = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const raw = options.rawProcessStartTime
      ? await options.rawProcessStartTime(pid, options)
      : await defaultProcessStartTime(pid, options.platform || process.platform);
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

function sha256Text(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function launchFingerprint(command, args = []) {
  return sha256Text(JSON.stringify({ command: String(command || ''), args: (Array.isArray(args) ? args : []).map(String) }));
}

async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function resolveExecutable(command, options = {}) {
  const text = String(command || '').trim();
  if (!text) return null;
  if (isAbsolute(text)) return text;
  if (text.includes('/') || text.includes('\\')) return resolve(options.cwd || process.cwd(), text);
  const platform = options.platform || process.platform;
  const resolver = platform === 'win32' ? 'where.exe' : 'which';
  try {
    const { stdout } = await execFileAsync(resolver, [text], {
      encoding: 'utf8', windowsHide: true, timeout: 3_000,
      env: { PATH: process.env.PATH || '', Path: process.env.Path || process.env.PATH || '', SystemRoot: process.env.SystemRoot || process.env.SYSTEMROOT || '' },
    });
    return stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
  } catch {
    return null;
  }
}

async function writeMcpProcessState(id, value) {
  const file = mcpStatePath(id);
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temp, file);
  return value;
}

export async function captureSupervisorIdentity(state, options = {}) {
  const pid = Number(state?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const reader = options.getProcessStartTime || readProcessStartTime;
  const processStartedAt = await reader(pid, options);
  if (!processStartedAt) return null;
  const executablePath = options.resolveExecutable
    ? await options.resolveExecutable(state.command, options)
    : await resolveExecutable(state.command, options);
  let executableSha256 = null;
  if (executablePath) {
    try {
      executableSha256 = options.hashExecutable
        ? await options.hashExecutable(executablePath, options)
        : await hashFile(executablePath);
    } catch {
      executableSha256 = null;
    }
  }
  return {
    version: SUPERVISOR_IDENTITY_VERSION,
    instance_id: randomUUID(),
    pid,
    process_started_at: processStartedAt,
    launch_sha256: launchFingerprint(state.command, state.args),
    executable_path: executablePath,
    executable_sha256: executableSha256,
    captured_at: new Date().toISOString(),
  };
}

async function attestManagedState(id, state, options = {}) {
  if (!state?.managed_process || !Number.isInteger(Number(state.pid)) || Number(state.pid) <= 0) return state;
  const supervisorIdentity = await captureSupervisorIdentity(state, options);
  if (!supervisorIdentity) {
    const error = new Error(`cannot capture supervisor identity for MCP process: ${id}`);
    error.code = 'DSH_PROCESS_IDENTITY_UNAVAILABLE';
    error.pid = state.pid;
    error.state_preserved = true;
    throw error;
  }
  return writeMcpProcessState(id, { ...state, supervisor_identity: supervisorIdentity });
}

export async function verifyManagedProcessIdentity(state, options = {}) {
  if (!state?.managed_process) return { matched: true, verified: false, managed_process: false };
  const pid = Number(state.pid);
  if (!Number.isInteger(pid) || pid <= 0) return { matched: false, verified: false, invalid: true, pid };

  const supervisor = state.supervisor_identity;
  const expectedRaw = supervisor?.process_started_at || state.started_at;
  const expected = parseStartedAt(expectedRaw);
  if (expected === null) return { matched: true, verified: false, legacy: true, pid };

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

  const toleranceMs = Math.max(1, Number(options.startTimeToleranceMs)
    || (supervisor ? SUPERVISOR_START_TIME_TOLERANCE_MS : DEFAULT_START_TIME_TOLERANCE_MS));
  const deltaMs = observed - expected;
  const result = {
    matched: Math.abs(deltaMs) <= toleranceMs,
    verified: true,
    supervisor_verified: Boolean(supervisor),
    legacy: !supervisor,
    pid,
    expected_started_at: new Date(expected).toISOString(),
    observed_started_at: new Date(observed).toISOString(),
    delta_ms: deltaMs,
    tolerance_ms: toleranceMs,
    instance_id: supervisor?.instance_id || null,
  };
  if (!result.matched || !supervisor) return result;

  if (Number(supervisor.pid) !== pid) return { ...result, matched: false, reason: 'supervisor pid mismatch' };
  const expectedLaunch = launchFingerprint(state.command, state.args);
  if (supervisor.launch_sha256 !== expectedLaunch) {
    return { ...result, matched: false, reason: 'launch fingerprint mismatch' };
  }
  if (supervisor.executable_path && supervisor.executable_sha256) {
    try {
      const currentHash = options.hashExecutable
        ? await options.hashExecutable(supervisor.executable_path, options)
        : await hashFile(supervisor.executable_path);
      if (currentHash !== supervisor.executable_sha256) {
        return { ...result, matched: false, reason: 'executable fingerprint mismatch' };
      }
    } catch (cause) {
      const error = new Error(`cannot verify executable fingerprint for MCP pid ${pid}`);
      error.code = 'DSH_PROCESS_IDENTITY_UNAVAILABLE';
      error.pid = pid;
      error.state_preserved = true;
      error.cause = cause;
      throw error;
    }
  }
  return result;
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
          supervisor_identity_verified: identity.supervisor_verified === true,
          identity_legacy: identity.legacy === true,
        };
      }
      if (!identity.exited) await rm(mcpStatePath(id), { force: true });
    }
  }

  const started = await (options.start || startMcp)(id, options);
  if (!started?.managed_process) return started;
  const attested = await attestManagedState(id, started, options);
  return { ...attested, identity_verified: true, supervisor_identity_verified: true };
}

export async function mcpStatusSafely(id, options = {}) {
  const status = await (options.status || mcpStatus)(id, options);
  const state = status?.state || await readMcpProcessState(id);
  if (!state?.managed_process) return { ...status, identity_verified: false, supervisor_identity_verified: false };

  const pid = Number(state.pid);
  const isRunning = options.isRunning || processRunning;
  if (!Number.isInteger(pid) || pid <= 0 || !isRunning(pid)) {
    return { ...status, running: false, identity_verified: false, supervisor_identity_verified: false };
  }

  const identity = await verifyManagedProcessIdentity(state, options);
  if (!identity.matched) {
    return {
      ...status,
      running: false,
      stale_state: true,
      pid_reused: !identity.exited,
      identity_verified: identity.verified,
      supervisor_identity_verified: false,
      identity,
    };
  }
  return {
    ...status,
    running: true,
    identity_verified: identity.verified,
    supervisor_identity_verified: identity.supervisor_verified === true,
    identity_legacy: identity.legacy === true,
    supervisor_instance_id: identity.instance_id || null,
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
      if (!exited && (state.supervisor_identity?.process_started_at || state.started_at)) {
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
    supervisor_identity_verified: identity.supervisor_verified === true,
    supervisor_instance_id: identity.instance_id || null,
    identity_legacy: identity.legacy === true,
  };
}

export async function restartMcpSafely(id, options = {}) {
  const stopped = await stopMcpSafely(id, options);
  const started = await startMcpSafely(id, options);
  return { ...started, restarted: true, previous: stopped };
}
