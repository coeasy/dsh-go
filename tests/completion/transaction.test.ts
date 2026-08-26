import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executePackageTransaction } from '../../runtime/transaction.mjs';

let previousHome: string | undefined;
let previousRegistry: string | undefined;
let root: string;

beforeEach(async () => {
  previousHome = process.env.DSH_RUNTIME_HOME;
  previousRegistry = process.env.DSH_REGISTRY;
  root = await mkdtemp(join(tmpdir(), 'dsh-completion-transaction-'));
  process.env.DSH_RUNTIME_HOME = root;
  process.env.DSH_REGISTRY = join(root, 'runtime.json');
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.DSH_RUNTIME_HOME; else process.env.DSH_RUNTIME_HOME = previousHome;
  if (previousRegistry === undefined) delete process.env.DSH_REGISTRY; else process.env.DSH_REGISTRY = previousRegistry;
});

function catalogItem(type: string, id: string, dependencies: any[] = []) {
  const source = { provider: 'github', repo: `owner/${id}`, ref: 'main', commit: (type === 'plugin' ? 'a' : 'b').repeat(40) };
  return {
    id, version: '0.1.0', channel: 'stable', source,
    artifact: { integrity: `sha256:${'c'.repeat(64)}` },
    runtime: { type }, capabilities: [type], dependencies, permissions: [], compatibility: {},
  };
}

describe('profile and bundle transaction planning', () => {
  it('resolves the complete graph before mutation and stays non-mutating in dry-run', async () => {
    const catalog = join(root, 'catalog.json');
    const profile = join(root, 'profile.json');
    await writeFile(catalog, JSON.stringify({
      registry_version: 3,
      schema_version: '3.0.0',
      defaults: { plugin_version: '0.1.0', skill_version: '0.1.0' },
      plugins: [
        catalogItem('plugin', 'core'),
        catalogItem('skill', 'helper', [{ type: 'plugin', id: 'core', range: '0.1.0' }]),
      ],
    }));
    await writeFile(profile, JSON.stringify({ name: 'developer', packages: [{ type: 'skill', id: 'helper', version: '0.1.0' }] }));

    const result = await executePackageTransaction(profile, { kind: 'profile', catalog, dryRun: true });
    expect(result.dry_run).toBe(true);
    expect(result.restart_required).toBe(false);
    expect(result.order.map((item) => item.key)).toEqual(['plugin:core', 'skill:helper']);
    await expect(import('node:fs/promises').then(({ access }) => access(process.env.DSH_REGISTRY!))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
