import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRegistryFile } from '../../runtime/resolver.mjs';
import { readRuntimeRegistry, writeRuntimeRegistry } from '../../runtime/registry.mjs';
import { createRuntimePackageRecord } from '../../runtime/lifecycle.mjs';
import { activatePackage } from '../../runtime/platform.mjs';
import { parseDshUri, protocolRegistration, runtimeArgsForRequest } from '../../runtime/host-bridge.mjs';

const originalCwd = process.cwd();
const originalFetch = globalThis.fetch;
const originalRegistry = process.env.DSH_REGISTRY;
const originalRegistryUrl = process.env.DSH_REGISTRY_URL;
const originalRegistryCache = process.env.DSH_REGISTRY_CACHE;

afterEach(() => {
  process.chdir(originalCwd);
  globalThis.fetch = originalFetch;
  if (originalRegistry === undefined) delete process.env.DSH_REGISTRY;
  else process.env.DSH_REGISTRY = originalRegistry;
  if (originalRegistryUrl === undefined) delete process.env.DSH_REGISTRY_URL;
  else process.env.DSH_REGISTRY_URL = originalRegistryUrl;
  if (originalRegistryCache === undefined) delete process.env.DSH_REGISTRY_CACHE;
  else process.env.DSH_REGISTRY_CACHE = originalRegistryCache;
  vi.restoreAllMocks();
});

describe('post-merge Runtime V3 hardening', () => {
  it('falls back to the remote Registry V3 when the packaged local catalog is absent and reuses cache offline', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-registry-fallback-'));
    process.chdir(root);
    delete process.env.DSH_REGISTRY;
    process.env.DSH_REGISTRY_URL = 'https://registry.example/registry-v3.json';
    process.env.DSH_REGISTRY_CACHE = join(root, 'cache', 'registry-v3.json');
    const registry = {
      registry_version: 3,
      defaults: { plugin_version: '0.1.0' },
      plugins: [],
    };
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify(registry),
    })) as unknown as typeof fetch;

    await expect(loadRegistryFile()).resolves.toMatchObject({ registry_version: 3, plugins: [] });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    globalThis.fetch = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    await expect(loadRegistryFile('https://registry.example/registry-v3.json')).resolves.toMatchObject({ registry_version: 3, plugins: [] });
  });

  it('hydrates security, capability, and conflict metadata from the immutable install lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-registry-hydration-'));
    const target = join(root, 'plugin');
    const registryFile = join(root, 'runtime.json');
    await mkdir(target, { recursive: true });
    const commit = 'a'.repeat(40);
    await writeFile(join(target, '.dsh-install.json'), JSON.stringify({
      runtime_registry_version: 3,
      id: 'demo',
      type: 'plugin',
      version: '1.0.0',
      channel: 'stable',
      source: { provider: 'github', repo: 'owner/demo', ref: 'main', commit },
      runtime: { type: 'plugin', activation: 'restart-required' },
      capabilities: ['plugin'],
      dependencies: [],
      permissions: ['filesystem.read'],
      compatibility: { node: '>=20.0.0' },
      publisher: { id: 'owner' },
      security: { provenance: 'verified' },
      conflicts: ['cap.exclusive'],
      replaces: ['legacy-demo'],
      provides: ['cap.demo'],
      type_config: { entry: 'index.mjs' },
      installed_at: '2026-08-26T00:00:00.000Z',
    }, null, 2));

    await writeRuntimeRegistry({
      schema_version: 3,
      generation: 0,
      packages: [{
        id: 'demo',
        type: 'plugin',
        version: '1.0.0',
        state: 'installed',
        enabled: true,
        activated: false,
        restart_required: true,
        path: target,
        commit,
      }],
    }, registryFile);

    const registry = await readRuntimeRegistry(registryFile);
    const record = registry.packages[0];
    expect(record.permissions).toEqual(['filesystem.read']);
    expect(record.provides).toEqual(['cap.demo']);
    expect(record.conflicts).toEqual(['cap.exclusive']);
    expect(record.replaces).toEqual(['legacy-demo']);
    expect(record.publisher).toEqual({ id: 'owner' });
    expect(record.security).toEqual({ provenance: 'verified' });
    expect(record.type_config).toEqual({ entry: 'index.mjs' });
  });

  it('allows a startup activation failure to be retried after the environment is fixed', () => {
    const failed = createRuntimePackageRecord('plugin', 'retryable', '1.0.0', {
      state: 'failed',
      enabled: true,
      activated: false,
      restart_required: true,
      health: { status: 'failed', phase: 'startup-activation' },
    });
    const active = activatePackage(failed, { kind: 'plugin', type: 'plugin', transport: 'local' });
    expect(active.state).toBe('active');
    expect(active.activated).toBe(true);
    expect(active.restart_required).toBe(false);
    expect(active.health).toBeNull();
    expect(active.history.some((entry: { event: string }) => entry.event === 'activation-verify')).toBe(true);
  });

  it('accepts Marketplace V2 links while preserving local approval and Registry routing', () => {
    const parsed = parseDshUri('dsh://install?id=demo&version=0.1.0&type=skill&registry=https%3A%2F%2Fexample.com%2Fregistry-v3.json');
    expect(parsed).toMatchObject({
      kind: 'skill',
      type: 'skill',
      action: 'install',
      spec: 'demo@0.1.0',
      marketplace_v2: true,
      registry: 'https://example.com/registry-v3.json',
    });
    expect(runtimeArgsForRequest(parsed)).toEqual([
      'skill', 'install', 'demo@0.1.0', '--registry', 'https://example.com/registry-v3.json',
    ]);
    expect(() => parseDshUri('dsh://install?id=demo&type=plugin&registry=https%3A%2F%2Fuser%3Apass%40example.com%2Fr.json')).toThrow(/without credentials/);
  });

  it('registers interactive protocol handlers instead of silently discarding browser install requests', () => {
    const linux = protocolRegistration({
      platform: 'linux',
      executable: '/usr/bin/node',
      scriptPath: '/opt/dsh/bin/dsh.mjs',
      wrapperFile: '/tmp/dsh-url-handler.sh',
      desktopFile: '/tmp/dsh.desktop',
    });
    expect(linux.desktop_content).toContain('Terminal=true');
    expect(linux.wrapper_content).toContain('host handle "$1" --yes');

    const windows = protocolRegistration({
      platform: 'win32',
      executable: 'C:/Program Files/nodejs/node.exe',
      scriptPath: 'C:/DSH/bin/dsh.mjs',
      wrapperFile: 'C:/DSH/url-handler.ps1',
    });
    expect(windows.wrapper_content).toContain('MessageBox');
    expect(windows.wrapper_content).toContain('host handle $Url --yes');
  });
});
