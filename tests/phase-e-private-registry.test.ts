import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

  it('inherits the installed registry automatically for update and repair', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-private-update-'));
    const runtimeFile = join(root, 'runtime.json');
    await writeFile(runtimeFile, JSON.stringify({
      schema_version: 3,
      generation: 4,
      packages: [{
        type: 'plugin',
        id: 'corp-package',
        version: '1.0.0',
        state: 'pending-restart',
        enabled: true,
        activated: false,
        restart_required: true,
        source: {
          provider: 'github',
          repo: 'acme/corp-package',
          commit: 'a'.repeat(40),
          registry: 'corp',
          registry_url: 'https://registry.example.test/registry-v3.json',
          registry_trusted: true,
          registry_organization: 'acme',
        },
        runtime: {},
        capabilities: [],
        dependencies: [],
      }],
    }));
    const update = await registryCli.inheritInstalledRegistryArgs(['plugin', 'update', 'corp-package', '--runtime-registry', runtimeFile]);
    const repair = await registryCli.inheritInstalledRegistryArgs(['plugin', 'repair', 'corp-package', '--runtime-registry', runtimeFile]);
    expect(update.slice(-2)).toEqual(['--registry', 'corp']);
    expect(repair.slice(-2)).toEqual(['--registry', 'corp']);
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

  it('never reuses a stale cache whose provenance belongs to another registry source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-private-stale-'));
    const cacheFile = join(root, 'registry-v3.json');
    await writeFile(cacheFile, JSON.stringify({ registry_version: 3, schema_version: '3.0.0', plugins: [{ id: 'wrong-source' }] }));
    await writeFile(`${cacheFile}.meta.json`, JSON.stringify({ source: 'https://registry-a.example/registry-v3.json', etag: 'a' }));
    globalThis.fetch = async () => { throw new Error('network unavailable'); };
    await expect(catalog.loadRegistrySource('https://registry-b.example/registry-v3.json', { cacheFile, allowStale: true })).rejects.toThrow('network unavailable');
  });

  it('does not leak private authorization by falling back to the public official registry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-private-no-fallback-'));
    const cacheFile = join(root, 'registry-v3.json');
    const requests: string[] = [];
    globalThis.fetch = async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return new Response('unavailable', { status: 503 });
    };
    await expect(catalog.ensureRegistryCache('https://registry.example.test/distribution-v1/index.json', {
      cacheFile,
      allowStale: false,
      headers: { Authorization: 'Bearer enterprise-token' },
    })).rejects.toThrow();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((url) => url.startsWith('https://registry.example.test/'))).toBe(true);
    expect(requests.some((url) => url.includes('coeasy.github.io'))).toBe(false);
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
