import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDoctor } from '../../runtime/doctor.mjs';
import { writeRuntimeRegistry } from '../../runtime/registry.mjs';

const ENV_KEYS = [
  'DSH_RUNTIME_HOME',
  'DSH_RUNTIME_REGISTRY',
  'DSH_CATALOG_REGISTRY',
  'DSH_REGISTRY',
  'DSH_REGISTRY_CACHE',
  'DSH_TRANSACTION_HOME',
] as const;
const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

let root: string;
let registryFile: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-doctor-'));
  registryFile = join(root, 'registry', 'runtime.json');
  process.env.DSH_RUNTIME_HOME = root;
  process.env.DSH_RUNTIME_REGISTRY = registryFile;
  process.env.DSH_REGISTRY_CACHE = join(root, 'cache', 'registry-v3.json');
  process.env.DSH_TRANSACTION_HOME = join(root, 'transactions');
  delete process.env.DSH_CATALOG_REGISTRY;
  delete process.env.DSH_REGISTRY;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

function runtimeOptions() {
  return { nodeVersion: '22.0.0', platform: 'linux', arch: 'x64', env: { PATH: '' } };
}

describe('unified dsh doctor', () => {
  it('reports a clean empty runtime without mutating package state', async () => {
    await writeRuntimeRegistry({ schema_version: 3, generation: 0, packages: [] }, registryFile);
    const result = await runDoctor('0.1.0', { registryFile, runtimeOptions: runtimeOptions() });

    expect(result.status).toBe('healthy');
    expect(result.runtime.runtime_version).toBe('0.1.0');
    expect(result.runtime.runtime_registry_schema).toBe(3);
    expect(result.registry.runtime.file).toBe(registryFile);
    expect(result.registry.runtime.env?.name).toBe('DSH_RUNTIME_REGISTRY');
    expect(result.summary.total).toBe(0);
    expect(result.transactions.pending).toBe(0);
    expect(result.packages).toEqual([]);
  });

  it('surfaces unfinished transaction journals as an actionable warning', async () => {
    await writeRuntimeRegistry({ schema_version: 3, generation: 0, packages: [] }, registryFile);
    const transactionDir = join(root, 'transactions', 'txn-1');
    await mkdir(transactionDir, { recursive: true });
    await writeFile(join(transactionDir, 'journal.json'), JSON.stringify({ id: 'txn-1', state: 'committing', expected_generation: 1 }));

    const result = await runDoctor('0.1.0', { registryFile, runtimeOptions: runtimeOptions() });
    expect(result.status).toBe('warning');
    expect(result.transactions.pending).toBe(1);
    expect(result.warnings).toContain('transactions:pending:1');
    expect(result.failures).toEqual([]);
  });

  it('fails diagnostics for a broken installed package and supports type filters', async () => {
    await writeRuntimeRegistry({
      schema_version: 3,
      generation: 0,
      packages: [{
        type: 'plugin',
        id: 'broken-package',
        version: '0.1.0',
        state: 'failed',
        enabled: true,
        activated: false,
        restart_required: true,
        path: join(root, 'missing-package'),
        source: { provider: 'github', repo: 'owner/broken-package', commit: '0123456789012345678901234567890123456789' },
        commit: '0123456789012345678901234567890123456789',
      }],
    }, registryFile);

    const result = await runDoctor('0.1.0', { registryFile, type: 'plugin', quick: true, runtimeOptions: runtimeOptions() });
    expect(result.status).toBe('failed');
    expect(result.summary.by_health.failed).toBe(1);
    expect(result.packages[0].key).toBe('plugin:broken-package');
    expect(result.packages[0].health.failed).toContain('lifecycle');
    expect(result.failures).toContain('packages:failed:1');
  });
});
