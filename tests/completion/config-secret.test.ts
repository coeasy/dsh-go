import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readPackageConfig, resolveConfigSecrets, setPackageConfig, unsetPackageConfig } from '../../runtime/config-store.mjs';
import { deleteSecret, getSecret, listSecrets, secretStorePaths, setSecret } from '../../runtime/secret-store.mjs';

let previousHome: string | undefined;

beforeEach(async () => {
  previousHome = process.env.DSH_RUNTIME_HOME;
  process.env.DSH_RUNTIME_HOME = await mkdtemp(join(tmpdir(), 'dsh-completion-secret-'));
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.DSH_RUNTIME_HOME;
  else process.env.DSH_RUNTIME_HOME = previousHome;
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

  it('rejects prototype-pollution config paths', async () => {
    await expect(setPackageConfig('skill', 'demo', '__proto__.polluted', 'true')).rejects.toThrow('unsafe config key');
  });
});
