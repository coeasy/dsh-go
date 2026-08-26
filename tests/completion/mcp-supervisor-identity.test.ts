import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  captureSupervisorIdentity,
  launchFingerprint,
  readMcpProcessState,
  startMcpSafely,
  verifyManagedProcessIdentity,
} from '../../runtime/mcp-process.mjs';

const ENV_KEYS = ['DSH_RUNTIME_HOME', 'DSH_EXECUTION_HOME'] as const;
const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-identity-'));
  process.env.DSH_RUNTIME_HOME = root;
  process.env.DSH_EXECUTION_HOME = join(root, 'run');
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('MCP supervisor identity', () => {
  it('fingerprints the exact launch contract', () => {
    expect(launchFingerprint('/usr/bin/node', ['server.mjs'])).toBe(launchFingerprint('/usr/bin/node', ['server.mjs']));
    expect(launchFingerprint('/usr/bin/node', ['server.mjs'])).not.toBe(launchFingerprint('/usr/bin/node', ['other.mjs']));
  });

  it('captures OS start time, instance identity, launch hash and executable hash', async () => {
    const identity = await captureSupervisorIdentity({ pid: 4242, command: '/fake/node', args: ['server.mjs'] }, {
      getProcessStartTime: async () => '2026-08-26T07:00:00.000Z',
      resolveExecutable: async () => '/fake/node',
      hashExecutable: async () => 'a'.repeat(64),
    });

    expect(identity).toMatchObject({
      version: 1,
      pid: 4242,
      process_started_at: '2026-08-26T07:00:00.000Z',
      launch_sha256: launchFingerprint('/fake/node', ['server.mjs']),
      executable_path: '/fake/node',
      executable_sha256: 'a'.repeat(64),
    });
    expect(identity?.instance_id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('fails identity verification when the executable fingerprint changes', async () => {
    const state = {
      managed_process: true,
      pid: 5151,
      command: '/fake/node',
      args: ['server.mjs'],
      supervisor_identity: {
        version: 1,
        instance_id: 'instance-1',
        pid: 5151,
        process_started_at: '2026-08-26T07:00:00.000Z',
        launch_sha256: launchFingerprint('/fake/node', ['server.mjs']),
        executable_path: '/fake/node',
        executable_sha256: 'a'.repeat(64),
      },
    };
    const identity = await verifyManagedProcessIdentity(state, {
      getProcessStartTime: async () => '2026-08-26T07:00:00.000Z',
      hashExecutable: async () => 'b'.repeat(64),
    });
    expect(identity).toMatchObject({ matched: false, verified: true, supervisor_verified: true, reason: 'executable fingerprint mismatch' });
  });

  it('attests newly started managed processes before returning them to the caller', async () => {
    const started = await startMcpSafely('attested', {
      start: async () => ({
        type: 'mcp', id: 'attested', transport: 'stdio', managed_process: true, running: true,
        pid: 6262, command: '/fake/node', args: ['server.mjs'], started_at: '2026-08-26T07:00:00.500Z',
      }),
      getProcessStartTime: async () => '2026-08-26T07:00:00.000Z',
      resolveExecutable: async () => '/fake/node',
      hashExecutable: async () => 'c'.repeat(64),
    });

    expect(started).toMatchObject({ identity_verified: true, supervisor_identity_verified: true });
    const state = await readMcpProcessState('attested');
    expect(state?.supervisor_identity).toMatchObject({
      pid: 6262,
      process_started_at: '2026-08-26T07:00:00.000Z',
      executable_sha256: 'c'.repeat(64),
    });
  });
});
