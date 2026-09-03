import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const registryCli = await import('../runtime/registry-cli-resolver.mjs');
const registries = await import('../runtime/registry-manager.mjs');

const ENV_KEYS = [
  'DSH_REGISTRIES_FILE',
  'DSH_REGISTRY_CACHE_DIR',
  'DSH_SELECTED_REGISTRY_NAME',
  'DSH_SELECTED_REGISTRY_URL',
  'DSH_SELECTED_REGISTRY_TRUSTED',
  'DSH_SELECTED_REGISTRY_ORGANIZATION',
  'DSH_REGISTRY_AUTH_ENV',
  'DSH_REGISTRY_CACHE',
];

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('Phase E deep-link registry trust binding', () => {
  it('rewrites a named deep-link registry to its configured URL and preserves trust/auth context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-deeplink-registry-'));
    const file = join(root, 'registries.json');
    process.env.DSH_REGISTRIES_FILE = file;
    process.env.DSH_REGISTRY_CACHE_DIR = join(root, 'cache');
    await registries.writeRegistries({
      registries: [{
        name: 'corp',
        url: 'https://registry.example.test/registry-v3.json',
        priority: 500,
        trusted: true,
        enabled: true,
        organization: 'acme',
        scope: 'private',
        auth_env: 'CORP_REGISTRY_TOKEN',
      }],
    }, file);

    const routed = await registryCli.resolveDeepLinkRegistryArgs([
      'host',
      'handle',
      'dsh://install?type=plugin&id=example&registry=corp',
      '--yes',
    ]);
    const url = new URL(routed[2]);
    expect(url.searchParams.get('registry')).toBe('https://registry.example.test/registry-v3.json');
    expect(process.env.DSH_SELECTED_REGISTRY_NAME).toBe('corp');
    expect(process.env.DSH_SELECTED_REGISTRY_TRUSTED).toBe('1');
    expect(process.env.DSH_SELECTED_REGISTRY_ORGANIZATION).toBe('acme');
    expect(process.env.DSH_REGISTRY_AUTH_ENV).toBe('CORP_REGISTRY_TOKEN');
    expect(process.env.DSH_REGISTRY_CACHE).toContain('corp-');
  });

  it('marks a direct HTTPS deep-link registry untrusted instead of treating it as official', async () => {
    const routed = await registryCli.resolveDeepLinkRegistryArgs([
      'host',
      'handle',
      'dsh://install?type=plugin&id=example&registry=https%3A%2F%2Funtrusted.example%2Fregistry-v3.json',
      '--yes',
    ]);
    expect(routed[2]).toContain('untrusted.example');
    expect(process.env.DSH_SELECTED_REGISTRY_NAME).toBe('https://untrusted.example/registry-v3.json');
    expect(process.env.DSH_SELECTED_REGISTRY_URL).toBe('https://untrusted.example/registry-v3.json');
    expect(process.env.DSH_SELECTED_REGISTRY_TRUSTED).toBe('0');
    expect(process.env.DSH_REGISTRY_AUTH_ENV).toBeUndefined();
  });

  it('fails closed for an unknown non-URL registry selector', async () => {
    await expect(registryCli.resolveDeepLinkRegistryArgs([
      'host',
      'handle',
      'dsh://install?type=plugin&id=example&registry=missing-registry',
      '--yes',
    ])).rejects.toMatchObject({ code: 'DSH_REGISTRY_NOT_FOUND' });
  });
});
