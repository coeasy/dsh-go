import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const { artifactIntegrity, registryContentHash, sha256, stableStringify } = await import('../../scripts/checksum.mjs');
const { installPackage } = await import('../../runtime/installer.mjs');
const { activatePendingPackages } = await import('../../runtime/startup.mjs');
const { readRuntimeRegistry, writeRuntimeRegistry } = await import('../../runtime/registry.mjs');
const { loadRegistrySource } = await import('../../runtime/catalog.mjs');
const { materializeRegistryDistribution } = await import('../../runtime/registry-distribution.mjs');
const { resolvePackage } = await import('../../runtime/resolver.mjs');
const { resolveAcrossRegistries, writeRegistries } = await import('../../runtime/registry-manager.mjs');
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await exec('git', args, { cwd, encoding: 'utf8' });
  return result.stdout.trim();
}

function packageRecord(id: string, version = '1.0.0', options: any = {}) {
  const commit = options.commit || version.replaceAll('.', '').padEnd(40, 'a').slice(0, 40);
  const source = { provider: 'github', repo: options.repo || `owner/${id}`, ref: 'main', commit };
  return {
    id,
    version,
    channel: 'stable',
    source,
    artifact: { kind: 'git-source', integrity: artifactIntegrity({ version, source }) },
    runtime: { type: options.type || 'plugin' },
    capabilities: [options.type || 'plugin'],
    dependencies: [],
    permissions: [],
    publisher: { id: options.publisher || 'owner' },
    security: options.security || {},
  };
}

function registry(records: any[]) {
  return {
    registry_version: 3,
    schema_version: '3.0.0',
    defaults: { plugin_version: '1.0.0' },
    plugins: records,
  };
}

describe('final acceptance: fault isolation and recovery', () => {
  it('activates healthy packages while failing a broken package closed', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'dsh-e2e-fault-fixture-'));
    const root = await mkdtemp(join(tmpdir(), 'dsh-e2e-fault-root-'));
    const registryFile = join(root, 'runtime.json');

    await git(fixture, ['init', '-q']);
    await git(fixture, ['config', 'user.email', 'acceptance@test.local']);
    await git(fixture, ['config', 'user.name', 'DSH Acceptance']);
    await writeFile(join(fixture, 'dsh-plugin.json'), JSON.stringify({ name: 'healthy-plugin' }));
    await git(fixture, ['add', '.']);
    await git(fixture, ['commit', '-m', 'healthy fixture']);
    const commit = await git(fixture, ['rev-parse', 'HEAD']);

    const version = '1.0.0';
    const source = { provider: 'github', repo: 'owner/healthy-plugin', ref: 'main', commit };
    const integrity = artifactIntegrity({ version, source });
    const healthy = {
      id: 'healthy-plugin',
      type: 'plugin',
      version,
      channel: 'stable',
      repo: source.repo,
      ref: source.ref,
      commit,
      source,
      artifact: { integrity },
      integrity,
      runtime: { type: 'plugin', permissions: { network: false, filesystem: false, process: false } },
      capabilities: ['plugin'],
      dependencies: [],
    };

    const installed = await installPackage(healthy, {
      root: join(root, 'plugins'),
      repositoryUrl: fixture,
    });

    await writeRuntimeRegistry({
      schema_version: 3,
      generation: 0,
      packages: [
        {
          id: healthy.id,
          type: healthy.type,
          version: healthy.version,
          state: 'pending-restart',
          enabled: true,
          activated: false,
          restart_required: true,
          path: installed.target,
          source,
          commit,
          runtime: healthy.runtime,
          capabilities: healthy.capabilities,
          dependencies: [],
        },
        {
          id: 'missing-mcp',
          type: 'mcp',
          version: '1.0.0',
          state: 'pending-restart',
          enabled: true,
          activated: false,
          restart_required: true,
          path: join(root, 'missing-mcp'),
          commit: '0123456789abcdef0123456789abcdef01234567',
          runtime: { type: 'mcp' },
          capabilities: ['mcp'],
          dependencies: [],
        },
      ],
    }, registryFile);

    const startup = await activatePendingPackages({ registryFile });
    expect(startup.healthy).toBe(false);
    expect(startup.activated.map((item: any) => item.key)).toContain('plugin:healthy-plugin');
    expect(startup.failed.map((item: any) => item.key)).toContain('mcp:missing-mcp');

    const runtime = await readRuntimeRegistry(registryFile);
    const healthyRecord = runtime.packages.find((item: any) => item.id === 'healthy-plugin');
    const failedRecord = runtime.packages.find((item: any) => item.id === 'missing-mcp');
    expect(healthyRecord?.state).toBe('active');
    expect(healthyRecord?.restart_required).toBe(false);
    expect(failedRecord?.state).toBe('failed');
    expect(failedRecord?.activated).toBe(false);
  }, 20_000);

  it('uses a same-source stale Registry cache during HTTP 503 and refreshes after recovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-e2e-registry-503-'));
    const cacheFile = join(root, 'registry-v3.json');
    const source = 'https://registry.example.test/registry-v3.json';
    await writeFile(cacheFile, JSON.stringify(registry([packageRecord('cached-package')])));
    await writeFile(`${cacheFile}.meta.json`, JSON.stringify({ source, etag: 'cached-v1' }));

    globalThis.fetch = async () => new Response('temporarily unavailable', { status: 503 });
    const stale = await loadRegistrySource(source, { cacheFile, allowStale: true });
    expect(stale.plugins.map((item: any) => item.id)).toEqual(['cached-package']);

    globalThis.fetch = async () => new Response(JSON.stringify(registry([packageRecord('fresh-package')])), {
      status: 200,
      headers: { 'content-type': 'application/json', etag: 'fresh-v2' },
    });
    const fresh = await loadRegistrySource(source, { cacheFile, allowStale: true });
    expect(fresh.plugins.map((item: any) => item.id)).toEqual(['fresh-package']);
  });

  it('rejects a stale Registry cache from another source instead of source-confusing recovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-e2e-stale-source-'));
    const cacheFile = join(root, 'registry-v3.json');
    await writeFile(cacheFile, JSON.stringify(registry([packageRecord('wrong-source-package')])));
    await writeFile(`${cacheFile}.meta.json`, JSON.stringify({
      source: 'https://registry-a.example.test/registry-v3.json',
      etag: 'registry-a-v1',
    }));
    globalThis.fetch = async () => { throw new Error('registry network unavailable'); };

    await expect(loadRegistrySource('https://registry-b.example.test/registry-v3.json', {
      cacheFile,
      allowStale: true,
    })).rejects.toThrow('registry network unavailable');
  });

  it('fails a corrupted Distribution shard closed and succeeds after the mirror shard is repaired', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-e2e-distribution-integrity-'));
    const distributionRoot = join(root, 'distribution-v1');
    const indexFile = join(distributionRoot, 'index.json');
    const shardFile = join(distributionRoot, 'shards', '00.json');
    const cacheFile = join(root, 'registry-v3.json');
    const pkg = packageRecord('integrity-package');
    const sourceRegistry: any = registry([pkg]);
    sourceRegistry.generated = { content_hash: registryContentHash(sourceRegistry) };
    const entries = [{ ordinal: 0, package: pkg }];
    const entriesHash = sha256(stableStringify(entries));
    const index = {
      format: 'dsh-registry-distribution',
      distribution_version: 1,
      registry_version: 3,
      schema_version: '3.0.0',
      content_hash: sourceRegistry.generated.content_hash,
      count: 1,
      package_count: 1,
      registry_header: {
        registry_version: 3,
        schema_version: '3.0.0',
        defaults: sourceRegistry.defaults,
        generated: sourceRegistry.generated,
      },
      shard_strategy: { algorithm: 'sha256', prefix_chars: 2, count: 1 },
      shards: [{ prefix: '00', path: 'shards/00.json', count: 1, content_hash: entriesHash }],
    };
    const badShard = {
      format: 'dsh-registry-distribution',
      distribution_version: 1,
      registry_version: 3,
      prefix: '00',
      count: 1,
      content_hash: '0'.repeat(64),
      entries,
    };
    const repairedShard = { ...badShard, content_hash: entriesHash };

    await mkdir(dirname(shardFile), { recursive: true });
    await writeFile(indexFile, JSON.stringify(index));
    await writeFile(shardFile, JSON.stringify(badShard));
    await expect(materializeRegistryDistribution(indexFile, { cacheFile })).rejects.toMatchObject({
      code: 'DSH_REGISTRY_DISTRIBUTION_INTEGRITY',
    });

    await writeFile(shardFile, JSON.stringify(repairedShard));
    const repaired = await materializeRegistryDistribution(indexFile, { cacheFile });
    expect(repaired.cache_hit).toBe(false);
    expect(repaired.index.content_hash).toBe(sourceRegistry.generated.content_hash);
  });

  it('blocks a revoked version and recovers only through an explicitly safe version', () => {
    const safe = packageRecord('revocation-package', '1.0.0');
    const revoked = packageRecord('revocation-package', '1.1.0', { security: { revoked: true } });
    const sourceRegistry = registry([safe, revoked]);

    expect(() => resolvePackage(sourceRegistry, 'plugin', 'revocation-package', '1.1.0')).toThrow(/revoked/i);
    const recovered = resolvePackage(sourceRegistry, 'plugin', 'revocation-package', '1.0.0');
    expect(recovered.version).toBe('1.0.0');
    expect(recovered.security?.revoked).not.toBe(true);
  });

  it('fails cross-Registry publisher conflicts closed and recovers with explicit Registry selection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-e2e-registry-conflict-'));
    const registryA = join(root, 'a.json');
    const registryB = join(root, 'b.json');
    const configFile = join(root, 'registries.json');
    await writeFile(registryA, JSON.stringify(registry([packageRecord('shared-package', '1.0.0', { publisher: 'publisher-a' })])));
    await writeFile(registryB, JSON.stringify(registry([packageRecord('shared-package', '1.0.0', { publisher: 'publisher-b' })])));
    await writeRegistries({
      registries: [
        { name: 'a', url: registryA, priority: 100, trusted: true },
        { name: 'b', url: registryB, priority: 90, trusted: true },
      ],
    }, configFile);

    await expect(resolveAcrossRegistries('shared-package', {
      type: 'plugin',
      version: '*',
      file: configFile,
    })).rejects.toMatchObject({ code: 'DSH_REGISTRY_IDENTITY_CONFLICT' });

    const recovered = await resolveAcrossRegistries('shared-package', {
      type: 'plugin',
      version: '*',
      registry: 'a',
      file: configFile,
    });
    expect(recovered.registry.name).toBe('a');
    expect(recovered.package.publisher?.id).toBe('publisher-a');
  });
});
