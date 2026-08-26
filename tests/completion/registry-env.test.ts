import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveRegistrySource } from '../../runtime/catalog.mjs';
import { registryPath, runtimeRegistryEnv } from '../../runtime/registry.mjs';

const original = {
  runtimeHome: process.env.DSH_RUNTIME_HOME,
  runtimeRegistry: process.env.DSH_RUNTIME_REGISTRY,
  catalogRegistry: process.env.DSH_CATALOG_REGISTRY,
  registry: process.env.DSH_REGISTRY,
};

afterEach(() => {
  if (original.runtimeHome === undefined) delete process.env.DSH_RUNTIME_HOME; else process.env.DSH_RUNTIME_HOME = original.runtimeHome;
  if (original.runtimeRegistry === undefined) delete process.env.DSH_RUNTIME_REGISTRY; else process.env.DSH_RUNTIME_REGISTRY = original.runtimeRegistry;
  if (original.catalogRegistry === undefined) delete process.env.DSH_CATALOG_REGISTRY; else process.env.DSH_CATALOG_REGISTRY = original.catalogRegistry;
  if (original.registry === undefined) delete process.env.DSH_REGISTRY; else process.env.DSH_REGISTRY = original.registry;
});

describe('runtime/catalog Registry environment isolation', () => {
  it('does not interpret a remote DSH_REGISTRY catalog URL as the local runtime state path', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-registry-env-'));
    process.env.DSH_RUNTIME_HOME = home;
    delete process.env.DSH_RUNTIME_REGISTRY;
    delete process.env.DSH_CATALOG_REGISTRY;
    process.env.DSH_REGISTRY = 'https://registry.example.test/catalog/registry-v3.json';

    expect(registryPath()).toBe(resolve(home, 'registry', 'runtime.json'));
    expect(runtimeRegistryEnv()).toBeNull();
    expect(await resolveRegistrySource()).toBe(process.env.DSH_REGISTRY);
  });

  it('supports independent explicit Runtime and Catalog Registry variables', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-registry-env-explicit-'));
    const runtimeFile = join(home, 'state', 'runtime.json');
    process.env.DSH_RUNTIME_HOME = home;
    process.env.DSH_RUNTIME_REGISTRY = runtimeFile;
    process.env.DSH_CATALOG_REGISTRY = 'https://catalog.example.test/registry-v3.json';
    process.env.DSH_REGISTRY = 'https://legacy.example.test/registry-v3.json';

    expect(registryPath()).toBe(resolve(runtimeFile));
    expect(runtimeRegistryEnv()).toEqual({ name: 'DSH_RUNTIME_REGISTRY', value: runtimeFile, legacy: false });
    expect(await resolveRegistrySource()).toBe(process.env.DSH_CATALOG_REGISTRY);
  });

  it('keeps legacy local DSH_REGISTRY runtime paths working when they are not catalog-shaped', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-registry-env-legacy-'));
    const legacyFile = join(home, 'runtime-state.json');
    delete process.env.DSH_RUNTIME_REGISTRY;
    delete process.env.DSH_CATALOG_REGISTRY;
    process.env.DSH_REGISTRY = legacyFile;

    expect(registryPath()).toBe(resolve(legacyFile));
    expect(runtimeRegistryEnv()).toEqual({ name: 'DSH_REGISTRY', value: legacyFile, legacy: true });
  });
});
