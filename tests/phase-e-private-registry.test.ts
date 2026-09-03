import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const catalog = await import('../runtime/catalog.mjs');
const registries = await import('../runtime/registry-manager.mjs');
const registryCli = await import('../runtime/registry-cli-resolver.mjs');
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of [
    'DSH_TEST_PRIVATE_REGISTRY_TOKEN',
    'DSH_REGISTRIES_FILE',
    'DSH_SELECTED_REGISTRY_NAME',
    'DSH_SELECTED_REGISTRY_URL',
    'DSH_SELECTED_REGISTRY_TRUSTED',
    'DSH_SELECTED_REGISTRY_ORGANIZATION',
    'DSH_REGISTRY_AUTH_ENV',
  ]) delete process.env[name];
});

describe('Phase E private registry', () => {
  it('persists only a credential environment reference, never the secret value', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-private-registry-'));
    const file = join(root, 'registries.json');
    process.env.DSH_TEST_PRIVATE_REGISTRY_TOKEN = 'super-secret-value';
    await registries.addRegistry('corp', 'https://registry.example.test/registry-v3.json', {
      file,
      priority: 500,
      trusted: true,
      organization: 'acme',
      scope: 'private',
      authEnv: 'DSH_TEST_PRIVATE_REGISTRY_TOKEN',
    });
    const raw = await readFile(file, 'utf8');
    expect(raw).toContain('DSH_TEST_PRIVATE_REGISTRY_TOKEN');
    expect(raw).not.toContain('super-secret-value');
    const config = await registries.readRegistries(file);
    const corp = config.registries.find((item: { name: string }) => item.name === 'corp');
    expect(corp).toMatchObject({ name: 'corp', organization: 'acme', scope: 'private', auth_env: 'DSH_TEST_PRIVATE_REGISTRY_TOKEN', trusted: true });
  });

  it('routes a named private registry into the normal public install path without persisting its token', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-private-route-'));
    const file = join(root, 'registries.json');
    await registries.writeRegistries({
      registries: [{
        name: 'corp',
        url: 'https://registry.example.test/registry-v3.json',
        priority: 500,
        trusted: true,
        enabled: true,
        organization: 'acme',
        scope: 'private',
        auth_env: 'DSH_TEST_PRIVATE_REGISTRY_TOKEN',
      }],
    }, file);
    process.env.DSH_REGISTRIES_FILE = file;
    const selected = await registryCli.resolveNamedRegistryArgs(['plugin', 'install', 'example', '--registry', 'corp', '--yes']);
    expect(selected.registry).toMatchObject({ name: 'corp', trusted: true, organization: 'acme', auth_env: 'DSH_TEST_PRIVATE_REGISTRY_TOKEN' });
    expect(selected.args).toContain('https://registry.example.test/registry-v3.json');
    expect(process.env.DSH_SELECTED_REGISTRY_NAME).toBe('corp');
    expect(process.env.DSH_SELECTED_REGISTRY_TRUSTED).toBe('1');
    expect(process.env.DSH_REGISTRY_AUTH_ENV).toBe('DSH_TEST_PRIVATE_REGISTRY_TOKEN');
  });

  it('passes an injected bearer credential to a direct private Registry V3 fetch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-private-fetch-'));
    const cacheFile = join(root, 'registry-v3.json');
    let authorization: string | null = null;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      authorization = headers.Authorization || headers.authorization || null;
      return new Response(JSON.stringify({ registry_version: 3, schema_version: '3.0.0', plugins: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json', etag: 'private-v1' },
      });
    };
    const result = await catalog.loadRegistrySource('https://registry.example.test/registry-v3.json', {
      cacheFile,
      allowStale: false,
      headers: { Authorization: 'Bearer enterprise-token' },
    });
    expect(result.registry_version).toBe(3);
    expect(authorization).toBe('Bearer enterprise-token');
  });

  it('fails closed when an auth_env is configured but not populated', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-private-missing-token-'));
    const file = join(root, 'registries.json');
    await registries.writeRegistries({
      registries: [{
        name: 'corp',
        url: 'https://registry.example.test/registry-v3.json',
        priority: 100,
        trusted: true,
        enabled: true,
        organization: 'acme',
        scope: 'private',
        auth_env: 'DSH_TEST_PRIVATE_REGISTRY_TOKEN',
      }],
    }, file);
    await expect(registries.resolveAcrossRegistries('missing', { type: 'plugin', file })).rejects.toMatchObject({ code: 'DSH_REGISTRY_AUTH_REQUIRED' });
  });
});
