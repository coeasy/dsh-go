import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readPackageConfig } from '../../runtime/config-store.mjs';
import { getSecret, listSecrets, secretStorePaths } from '../../runtime/secret-store.mjs';

const exec = promisify(execFile);
let previousHome: string | undefined;
let root: string;

beforeEach(async () => {
  previousHome = process.env.DSH_RUNTIME_HOME;
  root = await mkdtemp(join(tmpdir(), 'dsh-state-concurrency-'));
  process.env.DSH_RUNTIME_HOME = root;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.DSH_RUNTIME_HOME;
  else process.env.DSH_RUNTIME_HOME = previousHome;
});

async function control(args: string[]) {
  return exec(process.execPath, ['runtime/control-cli.mjs', ...args], {
    cwd: process.cwd(),
    env: { ...process.env, DSH_RUNTIME_HOME: root },
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
}

describe('cross-process local state consistency', () => {
  it('serializes first-use key creation and concurrent secret updates', async () => {
    const entries = Array.from({ length: 8 }, (_, index) => [`secret-${index}`, `value-${index}`] as const);
    await Promise.all(entries.map(([name, value]) => control(['secret', 'set', name, '--value', value])));

    expect(await listSecrets()).toEqual(entries.map(([name]) => name).sort());
    for (const [name, value] of entries) expect(await getSecret(name)).toBe(value);

    const paths = secretStorePaths();
    expect(paths.key_lock).toBe(`${paths.key}.lock`);
    expect(paths.data_lock).toBe(`${paths.data}.lock`);
  }, 20_000);

  it('preserves every concurrent package config update', async () => {
    const entries = Array.from({ length: 8 }, (_, index) => [`key${index}`, `value-${index}`] as const);
    await Promise.all(entries.map(([key, value]) => control(['skill', 'config', 'set', 'concurrent-skill', `runtime.${key}`, value])));

    const config = await readPackageConfig('skill', 'concurrent-skill');
    for (const [key, value] of entries) expect(config.runtime[key]).toBe(value);
  }, 20_000);
});
