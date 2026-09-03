import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addRegistry,
  loadMergedConfiguredRegistry,
  readRegistryConfig,
  refreshConfiguredRegistry,
} from '../runtime/registry-manager.mjs';
import { loadRegistryFile } from '../runtime/resolver.mjs';

let previousConfig: string | undefined;
let previousCache: string | undefined;

beforeEach(() => {
  previousConfig = process.env.DSH_REGISTRIES_FILE;
  previousCache = process.env.DSH_REGISTRIES_CACHE_HOME;
});

afterEach(() => {
  if (previousConfig === undefined) delete process.env.DSH_REGISTRIES_FILE; else process.env.DSH_REGISTRIES_FILE = previousConfig;
  if (previousCache === undefined) delete process.env.DSH_REGISTRIES_CACHE_HOME; else process.env.DSH_REGISTRIES_CACHE_HOME = previousCache;
});

function pkg(commit: string, integrity = `sha256-${commit.slice(0, 8)}`) {
  return {
    id: 'shared', version: '1.2.0', channel: 'stable',
    source: { provider: 'github', repo: 'owner/shared', ref: 'main', commit },
    artifact: { kind: 'git-source', integrity },
    runtime: { type: 'plugin' }, capabilities: ['plugin'], dependencies: [], permissions: [],
    publisher: { id: 'publisher-1' }, security: { yanked: false }, metadata: { name: 'Shared' },
  };
}

function registry(record: any, hash: string) {
  return {
    registry_version: 3,
    schema_version: '3.0.0',
    defaults: { plugin_version: '0.1.0' },
    generated: { at: '2026-09-03T00:00:00.000Z', count: 1, content_hash: hash },
    plugins: [record],
  };
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-registries-'));
  const config = join(root, 'registries.json');
  const cache = join(root, 'cache');
  process.env.DSH_REGISTRIES_FILE = config;
  process.env.DSH_REGISTRIES_CACHE_HOME = cache;
  return { root, config };
}

describe('Multi-Registry manager', () => {
  it('merges identical package identities deterministically and resolves named/@all registries', async () => {
    const { root, config } = await setup();
    const one = join(root, 'one.json');
    const two = join(root, 'two.json');
    const record = pkg('1111111111111111111111111111111111111111');
    await writeFile(one, JSON.stringify(registry(record, 'same-hash')));
    await writeFile(two, JSON.stringify(registry(record, 'same-hash')));
    await addRegistry('secondary', two, { file: config, priority: 20, trust: 'community' });
    await addRegistry('primary', one, { file: config, priority: 10, trust: 'verified' });

    const listed = await readRegistryConfig(config);
    expect(listed.registries.map((item) => item.name)).toEqual(['primary', 'secondary']);
    const merged = await loadMergedConfiguredRegistry({ file: config });
    expect(merged.registry.plugins).toHaveLength(1);
    expect(merged.registry.plugins[0].registry_sources).toEqual(['primary', 'secondary']);
    expect(merged.registry.generated.source_registries.map((item: any) => item.name)).toEqual(['primary', 'secondary']);

    expect((await loadRegistryFile('primary')).plugins[0].source.commit).toBe(record.source.commit);
    const all = await loadRegistryFile('@all');
    expect(all.plugins).toHaveLength(1);
    expect(all.plugins[0].registry_sources).toEqual(['primary', 'secondary']);
  });

  it('fails closed when the same logical version has different commit/integrity identity', async () => {
    const { root, config } = await setup();
    const one = join(root, 'one.json');
    const two = join(root, 'two.json');
    await writeFile(one, JSON.stringify(registry(pkg('1111111111111111111111111111111111111111'), 'hash-1')));
    await writeFile(two, JSON.stringify(registry(pkg('2222222222222222222222222222222222222222'), 'hash-2')));
    await addRegistry('one', one, { file: config, priority: 10 });
    await addRegistry('two', two, { file: config, priority: 20 });
    await expect(loadMergedConfiguredRegistry({ file: config })).rejects.toMatchObject({
      code: 'DSH_REGISTRY_IDENTITY_CONFLICT', package: 'plugin:shared@1.2.0#stable',
    });
  });

  it('requires mirror snapshot convergence during refresh', async () => {
    const { root, config } = await setup();
    const primary = join(root, 'primary.json');
    const mirror = join(root, 'mirror.json');
    const record = pkg('3333333333333333333333333333333333333333');
    await writeFile(primary, JSON.stringify(registry(record, 'primary-hash')));
    await writeFile(mirror, JSON.stringify(registry(record, 'mirror-hash')));
    await addRegistry('mirrored', primary, { file: config, mirrors: [mirror] });
    await expect(refreshConfiguredRegistry('mirrored', { file: config })).rejects.toMatchObject({ code: 'DSH_REGISTRY_IDENTITY_CONFLICT' });

    await writeFile(mirror, JSON.stringify(registry(record, 'primary-hash')));
    const refreshed = await refreshConfiguredRegistry('mirrored', { file: config });
    expect(refreshed.healthy).toBe(true);
    expect(refreshed.mirrors).toEqual([expect.objectContaining({ converged: true, content_hash: 'primary-hash' })]);
  });
});
