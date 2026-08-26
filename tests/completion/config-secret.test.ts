import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readPackageConfig, resolveConfigSecrets, setPackageConfig, unsetPackageConfig } from '../../runtime/config-store.mjs';
import { deleteSecret, getSecret, listSecrets, secretStorePaths, secretStoreStatus, setSecret } from '../../runtime/secret-store.mjs';

let previousHome: string | undefined;
let previousBackend: string | undefined;

beforeEach(async () => {
  previousHome = process.env.DSH_RUNTIME_HOME;
  previousBackend = process.env.DSH_SECRET_KEY_BACKEND;
  process.env.DSH_RUNTIME_HOME = await mkdtemp(join(tmpdir(), 'dsh-completion-secret-'));
  process.env.DSH_SECRET_KEY_BACKEND = 'file';
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.DSH_RUNTIME_HOME;
  else process.env.DSH_RUNTIME_HOME = previousHome;
  if (previousBackend === undefined) delete process.env.DSH_SECRET_KEY_BACKEND;
  else process.env.DSH_SECRET_KEY_BACKEND = previousBackend;
});

describe('package config and local secret store', () => {
  it('encrypts secrets at rest and resolves explicit secret references', async () => {
    await setSecret('github.token', 'super-secret-token');
    expect(await listSecrets()).toEqual(['github.token']);
    expect(await getSecret('github.token')).toBe('super-secret-token');

    const paths = secretStorePaths();
    const encrypted = await readFile(paths.data, 'utf8');
    expect(encrypted).not.toContain('super-secret-token');
    expect(JSON.parse(encrypted).algorithm).toBe('aes-256-gcm');

    await setPackageConfig('mcp', 'demo', 'mcp.env.GITHUB_TOKEN', '{"$secret":"github.token"}');
    await setPackageConfig('mcp', 'demo', 'mcp.args', '["serve"]');
    const config = await readPackageConfig('mcp', 'demo');
    expect(config.mcp.args).toEqual(['serve']);
    expect(config.mcp.env.GITHUB_TOKEN).toEqual({ $secret: 'github.token' });

    const resolved = await resolveConfigSecrets(config, getSecret);
    expect(resolved.mcp.env.GITHUB_TOKEN).toBe('super-secret-token');

    await unsetPackageConfig('mcp', 'demo', 'mcp.args');
    expect((await readPackageConfig('mcp', 'demo')).mcp.args).toBeUndefined();
    expect((await deleteSecret('github.token')).deleted).toBe(true);
  });

  it('keeps an existing file key readable when auto backend selection is enabled', async () => {
    await setSecret('legacy.token', 'legacy-secret');
    process.env.DSH_SECRET_KEY_BACKEND = 'auto';

    expect(await getSecret('legacy.token')).toBe('legacy-secret');
    expect(await secretStoreStatus()).toMatchObject({
      configured_backend: 'auto',
      active_backend: 'file',
      native_backend: false,
      legacy_file_key: true,
      encrypted_data_present: true,
    });
  });

  it('fails closed when encrypted data remains but its master key is missing', async () => {
    await setSecret('orphan.token', 'orphan-secret');
    const paths = secretStorePaths();
    await rm(paths.key, { force: true });

    await expect(getSecret('orphan.token')).rejects.toMatchObject({
      code: 'DSH_SECRET_MASTER_KEY_MISSING',
    });
    expect(await readFile(paths.data, 'utf8')).not.toContain('orphan-secret');
  });

  it('rejects unsupported key backends instead of silently weakening storage', async () => {
    process.env.DSH_SECRET_KEY_BACKEND = 'not-a-backend';
    await expect(setSecret('invalid.backend', 'value')).rejects.toThrow('unsupported DSH secret key backend');
  });

  it('reports an uninitialized store without creating key material', async () => {
    expect(await secretStoreStatus()).toMatchObject({
      configured_backend: 'file',
      active_backend: 'uninitialized',
      native_backend: false,
      encrypted_data_present: false,
      legacy_file_key: false,
    });
  });

  it('rejects prototype-pollution config paths', async () => {
    await expect(setPackageConfig('skill', 'demo', '__proto__.polluted', 'true')).rejects.toThrow('unsafe config key');
  });
});
