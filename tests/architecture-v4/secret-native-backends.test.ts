import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  configuredSecretKeyBackend,
  createSecretMasterKey,
  preferredSecretKeyBackend,
  readExistingSecretMasterKey,
  secretProviderStatus,
} from '../../runtime/secret-provider.mjs';

function pathsFor(root: string) {
  const base = join(root, 'secrets');
  return {
    base,
    key: join(base, 'master.key'),
    backend: join(base, 'master.backend.json'),
    dpapi: join(base, 'master.dpapi'),
  };
}

describe('native secret key backends', () => {
  it('selects a native backend for every supported Runtime platform', () => {
    expect(preferredSecretKeyBackend('win32')).toBe('dpapi');
    expect(preferredSecretKeyBackend('darwin')).toBe('keychain');
    expect(preferredSecretKeyBackend('linux')).toBe('secret-service');
    expect(preferredSecretKeyBackend('freebsd')).toBeNull();
    expect(configuredSecretKeyBackend({ DSH_SECRET_KEY_BACKEND: 'keychain' })).toBe('keychain');
  });

  it('stores and reads the macOS master key through Keychain metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-keychain-create-'));
    const paths = pathsFor(root);
    let stored = '';
    const calls: Array<{ command: string; args: string[] }> = [];
    const runCommand = async (command: string, args: string[]) => {
      calls.push({ command, args });
      if (args[0] === 'add-generic-password') {
        stored = String(args.at(-1) || '');
        return '';
      }
      if (args[0] === 'find-generic-password') return `${stored}\n`;
      throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
    };

    const created = await createSecretMasterKey(paths, 'keychain', { platform: 'darwin', runCommand });
    expect(created.backend).toBe('keychain');
    expect(created.key.byteLength).toBe(32);
    expect(calls[0].command).toBe('/usr/bin/security');
    expect(calls[0].args.slice(0, 6)).toEqual(['add-generic-password', '-U', '-a', expect.any(String), '-s', 'dsh-go.secret-master-key']);

    const marker = JSON.parse(await readFile(paths.backend, 'utf8'));
    expect(marker).toMatchObject({ version: 1, backend: 'keychain', service: 'dsh-go.secret-master-key' });
    expect(marker.account).toMatch(/^[a-f0-9]{32}$/);
    expect(await access(paths.key).then(() => true, () => false)).toBe(false);

    const secondRoot = await mkdtemp(join(tmpdir(), 'dsh-keychain-read-'));
    const secondPaths = pathsFor(secondRoot);
    await mkdir(secondPaths.base, { recursive: true });
    await writeFile(secondPaths.backend, `${JSON.stringify(marker, null, 2)}\n`);
    const read = await readExistingSecretMasterKey(secondPaths, { platform: 'darwin', runCommand });
    expect(read?.backend).toBe('keychain');
    expect(read?.key.equals(created.key)).toBe(true);
    expect(calls.at(-1)?.args[0]).toBe('find-generic-password');
  });

  it('fails closed in auto mode when the native backend is unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-secret-fail-closed-'));
    const paths = pathsFor(root);
    const runCommand = async () => {
      const error = new Error('native secret service unavailable') as Error & { code?: string };
      error.code = 'DSH_SECRET_BACKEND_UNAVAILABLE';
      throw error;
    };

    await expect(createSecretMasterKey(paths, 'auto', { platform: 'linux', runCommand })).rejects.toMatchObject({
      code: 'DSH_SECRET_NATIVE_BACKEND_REQUIRED',
      backend: 'secret-service',
      explicit_file_fallback_required: true,
    });
    expect(await access(paths.key).then(() => true, () => false)).toBe(false);
    expect(await access(paths.backend).then(() => true, () => false)).toBe(false);
  });

  it('uses file protection only after an explicit opt-in', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-secret-explicit-file-'));
    const paths = pathsFor(root);
    const created = await createSecretMasterKey(paths, 'file', { platform: 'linux' });
    expect(created.backend).toBe('file');
    expect(Buffer.from((await readFile(paths.key, 'utf8')).trim(), 'base64').equals(created.key)).toBe(true);

    const status = await secretProviderStatus(paths, 'file', { platform: 'linux' });
    expect(status).toMatchObject({
      configured_backend: 'file',
      active_backend: 'file',
      native_backend: false,
      native_backend_available: 'secret-service',
      migration_recommended: true,
      legacy_file_key: true,
    });
  });
});
