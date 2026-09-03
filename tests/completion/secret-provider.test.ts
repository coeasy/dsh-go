import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createSecretMasterKey,
  preferredSecretKeyBackend,
  readExistingSecretMasterKey,
  runSecretBackendCommand,
  secretProviderStatus,
} from '../../runtime/secret-provider.mjs';

function paths(base: string) {
  return {
    base,
    key: join(base, 'master.key'),
    backend: join(base, 'master.backend.json'),
    dpapi: join(base, 'master.dpapi'),
  };
}

describe('native secret key providers', () => {
  it('selects DPAPI on Windows and Secret Service on Linux for new stores', () => {
    expect(preferredSecretKeyBackend('win32')).toBe('dpapi');
    expect(preferredSecretKeyBackend('linux')).toBe('secret-service');
    expect(preferredSecretKeyBackend('darwin')).toBe('file');
  });

  it('falls back to file keys for headless Linux when Secret Service is unavailable', async () => {
    const base = await mkdtemp(join(tmpdir(), 'dsh-secret-provider-linux-'));
    const store = paths(base);
    const runCommand = async () => {
      const error = new Error('secret service unavailable') as Error & { code?: string };
      error.code = 'DSH_SECRET_BACKEND_UNAVAILABLE';
      throw error;
    };

    const created = await createSecretMasterKey(store, 'auto', { platform: 'linux', runCommand });
    expect(created).toMatchObject({ backend: 'file', fallback_from: 'secret-service' });
    await expect(access(store.key)).resolves.toBeUndefined();
    expect(Buffer.from((await readFile(store.key, 'utf8')).trim(), 'base64')).toHaveLength(32);
  });

  it('uses DPAPI for a new Windows store without placing the master key in master.key', async () => {
    const base = await mkdtemp(join(tmpdir(), 'dsh-secret-provider-win-'));
    const store = paths(base);
    const runCommand = async (_command: string, _args: string[], input: string) => `wrapped:${input.trim()}`;

    const created = await createSecretMasterKey(store, 'auto', { platform: 'win32', runCommand });
    expect(created.backend).toBe('dpapi');
    expect(JSON.parse(await readFile(store.backend, 'utf8'))).toMatchObject({ backend: 'dpapi', version: 1 });
    expect(await readFile(store.dpapi, 'utf8')).toMatch(/^wrapped:/);
    await expect(access(store.key)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves an existing file key instead of auto-migrating it', async () => {
    const base = await mkdtemp(join(tmpdir(), 'dsh-secret-provider-existing-'));
    const store = paths(base);
    const key = Buffer.alloc(32, 7);
    await writeFile(store.key, `${key.toString('base64')}\n`, { mode: 0o600 });

    const existing = await readExistingSecretMasterKey(store, { platform: 'win32' });
    expect(existing).toMatchObject({ backend: 'file' });
    expect(existing?.key.equals(key)).toBe(true);
    expect(await secretProviderStatus(store, 'auto', { platform: 'win32' })).toMatchObject({
      active_backend: 'file',
      preferred_new_backend: 'dpapi',
      automatic_migration: false,
      migration_recommended: true,
      legacy_file_key: true,
    });
  });

  it('force-kills a secret backend that ignores SIGTERM after the timeout', async () => {
    await expect(runSecretBackendCommand(
      process.execPath,
      ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
      '',
      { env: process.env, timeoutMs: 20 },
    )).rejects.toMatchObject({ code: 'DSH_SECRET_BACKEND_TIMEOUT' });
  }, 5_000);
});
