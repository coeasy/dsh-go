import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startMcp } from '../../runtime/execution.mjs';
import {
  mcpStatePath,
  mcpStatusSafely,
  processRunning,
  readMcpProcessState,
  restartMcpSafely,
  startMcpSafely,
  stopMcpSafely,
  verifyManagedProcessIdentity,
} from '../../runtime/mcp-process.mjs';
import { writeRuntimeRegistry } from '../../runtime/registry.mjs';

const ENV_KEYS = ['DSH_RUNTIME_HOME', 'DSH_RUNTIME_REGISTRY', 'DSH_EXECUTION_HOME', 'DSH_REGISTRY'] as const;
const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
let root: string;
let registryFile: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-mcp-lifecycle-'));
  registryFile = join(root, 'registry', 'runtime.json');
  process.env.DSH_RUNTIME_HOME = root;
  process.env.DSH_RUNTIME_REGISTRY = registryFile;
  process.env.DSH_EXECUTION_HOME = join(root, 'run');
  delete process.env.DSH_REGISTRY;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

async function writeManagedState(id: string, pid = 4242, extra: Record<string, unknown> = {}) {
  const file = mcpStatePath(id);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({ type: 'mcp', id, transport: 'stdio', managed_process: true, running: true, pid, ...extra })}\n`);
  return file;
}

function activeMcp(id: string, packageDir: string, server: string) {
  const commit = 'a'.repeat(40);
  return {
    type: 'mcp', id, version: '0.1.0', state: 'active', channel: 'stable', enabled: true, activated: true,
    restart_required: false, path: packageDir, permissions: ['process.spawn'],
    source: { provider: 'github', repo: `owner/${id}`, commit }, commit,
    binding: {
      target: packageDir, transport: 'local', kind: 'mcp', declared_permissions: ['process.spawn'], permission_policy: null,
      manifest: { mcp: { transport: 'stdio', command: process.execPath, args: [server] } },
    },
  };
}

describe('managed MCP process lifecycle', () => {
  it('preserves state and blocks restart when SIGTERM does not lead to exit', async () => {
    const file = await writeManagedState('stubborn');
    let started = false;
    let signals = 0;

    await expect(restartMcpSafely('stubborn', {
      timeoutMs: 3,
      pollMs: 1,
      isRunning: () => true,
      signal: () => { signals += 1; },
      sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
      start: async () => { started = true; return { started: true }; },
    })).rejects.toMatchObject({ code: 'DSH_PROCESS_STOP_TIMEOUT', pid: 4242, state_preserved: true });

    expect(signals).toBe(1);
    expect(started).toBe(false);
    await expect(access(file)).resolves.toBeUndefined();
    expect((await readMcpProcessState('stubborn'))?.pid).toBe(4242);
  });

  it('cleans stale state when the recorded managed process is already gone', async () => {
    const file = await writeManagedState('stale', 5151);
    const result = await stopMcpSafely('stale', { isRunning: () => false });
    expect(result).toMatchObject({ stopped: true, pid: 5151, exit_confirmed: true });
    await expect(access(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses to signal a reused PID and preserves the state for diagnosis', async () => {
    const startedAt = '2026-08-26T00:00:00.000Z';
    const file = await writeManagedState('reused-stop', 6262, { started_at: startedAt });
    let signals = 0;

    await expect(stopMcpSafely('reused-stop', {
      isRunning: () => true,
      getProcessStartTime: async () => '2026-08-26T00:05:00.000Z',
      signal: () => { signals += 1; },
    })).rejects.toMatchObject({
      code: 'DSH_PROCESS_IDENTITY_MISMATCH',
      pid: 6262,
      state_preserved: true,
    });

    expect(signals).toBe(0);
    await expect(access(file)).resolves.toBeUndefined();
    expect((await readMcpProcessState('reused-stop'))?.started_at).toBe(startedAt);
  });

  it('removes a reused-PID stale state before starting a replacement process', async () => {
    const file = await writeManagedState('reused-start', 7373, { started_at: '2026-08-26T00:00:00.000Z' });
    let starts = 0;
    const result = await startMcpSafely('reused-start', {
      isRunning: () => true,
      getProcessStartTime: async () => '2026-08-26T00:10:00.000Z',
      start: async () => {
        starts += 1;
        return { type: 'mcp', id: 'reused-start', pid: 8484, running: true };
      },
    });

    expect(starts).toBe(1);
    expect(result).toMatchObject({ id: 'reused-start', pid: 8484, running: true });
    expect(result.already_running).not.toBe(true);
    await expect(access(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports a reused PID as stale instead of claiming the MCP is running', async () => {
    const state = {
      type: 'mcp', id: 'reused-status', transport: 'stdio', managed_process: true, running: true,
      pid: 9595, started_at: '2026-08-26T00:00:00.000Z',
    };
    const result = await mcpStatusSafely('reused-status', {
      isRunning: () => true,
      getProcessStartTime: async () => '2026-08-26T00:20:00.000Z',
      status: async () => ({ type: 'mcp', id: 'reused-status', running: true, pid: 9595, state }),
    });

    expect(result).toMatchObject({
      running: false,
      stale_state: true,
      pid_reused: true,
      identity_verified: true,
    });
  });

  it('accepts legacy managed state without start identity for backward compatibility', async () => {
    const identity = await verifyManagedProcessIdentity({ managed_process: true, pid: 1010 });
    expect(identity).toMatchObject({ matched: true, verified: false, legacy: true, pid: 1010 });
  });

  it('waits for a real child process to exit before removing its state', async () => {
    const packageDir = join(root, 'mcp-package');
    const server = join(packageDir, 'server.mjs');
    await mkdir(packageDir, { recursive: true });
    await writeFile(server, `
      process.on('SIGTERM', () => process.exit(0));
      setInterval(() => {}, 1000);
    `);
    await writeRuntimeRegistry({ schema_version: 3, generation: 0, packages: [activeMcp('managed', packageDir, server)] }, registryFile);

    const started = await startMcp('managed');
    expect(started.pid).toBeTypeOf('number');
    expect(processRunning(started.pid)).toBe(true);

    const stopped = await stopMcpSafely('managed', { timeoutMs: 5000 });
    expect(stopped).toMatchObject({ stopped: true, pid: started.pid, exit_confirmed: true, identity_verified: true });
    expect(processRunning(started.pid)).toBe(false);
    expect(await readMcpProcessState('managed')).toBeNull();
  }, 15_000);
});
