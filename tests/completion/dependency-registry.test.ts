import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findRuntimeDependents, planRuntimeRemoval } from '../../runtime/dependency-guard.mjs';
import { readRuntimeRegistry, writeRuntimeRegistry } from '../../runtime/registry.mjs';

type RuntimeRecord = {
  type: string;
  id: string;
  version: string;
  state: string;
  enabled: boolean;
  activated: boolean;
  restart_required: boolean;
  dependencies: unknown[];
};

let previousHome: string | undefined;
let previousRegistry: string | undefined;
let registryFile: string;

beforeEach(async () => {
  previousHome = process.env.DSH_RUNTIME_HOME;
  previousRegistry = process.env.DSH_REGISTRY;
  const root = await mkdtemp(join(tmpdir(), 'dsh-completion-registry-'));
  process.env.DSH_RUNTIME_HOME = root;
  registryFile = join(root, 'registry.json');
  process.env.DSH_REGISTRY = registryFile;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.DSH_RUNTIME_HOME; else process.env.DSH_RUNTIME_HOME = previousHome;
  if (previousRegistry === undefined) delete process.env.DSH_REGISTRY; else process.env.DSH_REGISTRY = previousRegistry;
});

function record(type: string, id: string, dependencies: unknown[] = []): RuntimeRecord {
  return { type, id, version: '0.1.0', state: 'active', enabled: true, activated: true, restart_required: false, dependencies };
}

describe('runtime dependency guard and generation CAS', () => {
  it('blocks removal of required packages and orders cascade dependents first', async () => {
    const initial = { schema_version: 3, generation: 0, packages: [
      record('plugin', 'core'),
      record('skill', 'helper', [{ type: 'plugin', id: 'core', range: '*' }]),
      record('agent', 'worker', [{ type: 'skill', id: 'helper', range: '*' }]),
    ] };
    await writeRuntimeRegistry(initial, registryFile);
    const registry = await readRuntimeRegistry(registryFile);
    expect(findRuntimeDependents(registry, 'plugin', 'core').map((item: { key: string }) => item.key)).toEqual(['skill:helper']);
    await expect(planRuntimeRemoval('plugin', 'core', { registry })).rejects.toMatchObject({ code: 'DSH_PACKAGE_IN_USE' });
    const cascade = await planRuntimeRemoval('plugin', 'core', { registry, cascade: true });
    expect(cascade.order.map((item: { key: string }) => item.key)).toEqual(['agent:worker', 'skill:helper', 'plugin:core']);
  });

  it('rejects stale generation writes instead of silently losing an update', async () => {
    await writeRuntimeRegistry({ schema_version: 3, generation: 0, packages: [record('plugin', 'one')] }, registryFile);
    const staleA = await readRuntimeRegistry(registryFile);
    const staleB = await readRuntimeRegistry(registryFile);
    staleA.packages.push(record('skill', 'two'));
    await writeRuntimeRegistry(staleA, registryFile);
    staleB.packages.push(record('mcp', 'three'));
    await expect(writeRuntimeRegistry(staleB, registryFile)).rejects.toMatchObject({ code: 'DSH_REGISTRY_CONFLICT' });
    const latest = await readRuntimeRegistry(registryFile);
    expect(latest.packages.some((item: { id: string }) => item.id === 'two')).toBe(true);
    expect(latest.packages.some((item: { id: string }) => item.id === 'three')).toBe(false);
  });
});
