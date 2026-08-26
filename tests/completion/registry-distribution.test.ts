import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { registryContentHash } from '../../scripts/checksum.mjs';
import { buildDistributionDelta, distributionPackageKey, writeRegistryDistribution } from '../../scripts/registry-distribution.mjs';
import { ensureRegistryCache } from '../../runtime/catalog.mjs';
import { loadDistributedPackage, materializeRegistryDistribution } from '../../runtime/registry-distribution.mjs';

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done())))); });

function packageRecord(id: string, type = 'plugin', commitSeed = 'a') {
  const commit = commitSeed.repeat(40).slice(0, 40);
  return {
    id,
    version: '0.1.0',
    source: { provider: 'github', repo: `fixture/${id}`, ref: 'main', commit, archive_url: `https://github.com/fixture/${id}/archive/${commit}.tar.gz` },
    artifact: { kind: 'git-source', algorithm: 'sha256', integrity_scope: 'source-identity', integrity: `sha256-${commit}` },
    runtime: { type, activation: 'restart-required' },
    capabilities: [type], dependencies: [], metadata: { name: id },
  };
}
function registry(records: any[], at = '2026-08-26T00:00:00.000Z') {
  const value: any = { registry_version: 3, schema_version: '3.0.0', defaults: { plugin_version: '0.1.0' }, generated: { at, count: records.length, content_hash: '' }, plugins: records };
  value.generated.content_hash = registryContentHash(value);
  return value;
}
async function distributionFileCount(out: string) {
  const shards = await readdir(join(out, 'shards'));
  const root = await readdir(out);
  return shards.length + root.filter((name) => name !== 'shards').length;
}

describe('Registry Distribution V1', () => {
  it('builds 256 shards plus index/delta while preserving package-level records as shard projections', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-registry-distribution-'));
    const out = join(root, 'distribution-v1');
    const previous = registry([packageRecord('alpha', 'plugin', 'a'), packageRecord('beta', 'plugin', 'b')]);
    const current = registry([packageRecord('alpha', 'plugin', 'c'), packageRecord('gamma', 'mcp', 'd')], '2026-08-26T01:00:00.000Z');
    const delta = buildDistributionDelta(current, previous);
    expect(delta.changed.map((item: any) => item.key).sort()).toEqual(['mcp:gamma', 'plugin:alpha']);
    expect(delta.removed).toEqual(['plugin:beta']);

    const result = await writeRegistryDistribution(current, out, { delta, concurrency: 4 });
    expect(result.shards).toBe(256);
    expect(result.static_files).toBe(258);
    expect(await distributionFileCount(out)).toBe(258);
    expect(await readdir(out)).not.toContain('packages');

    const index = JSON.parse(await readFile(join(out, 'index.json'), 'utf8'));
    expect(index.content_hash).toBe(current.generated.content_hash);
    expect(index.shards).toHaveLength(256);
    expect(index.shards.reduce((sum: number, shard: any) => sum + shard.count, 0)).toBe(2);
    expect(index.package_strategy).toMatchObject({ materialization: 'dynamic', fallback: 'shard-projection' });
    const alphaKey = distributionPackageKey('plugin', 'alpha');
    expect(index.packages[alphaKey]).toEqual(expect.objectContaining({ prefix: expect.stringMatching(/^[0-9a-f]{2}$/), content_hash: expect.stringMatching(/^[0-9a-f]{64}$/), count: 1 }));
    expect(index.packages[alphaKey].path).toBeUndefined();

    const cacheFile = join(root, 'materialized.json');
    const materialized = await materializeRegistryDistribution(join(out, 'index.json'), { cacheFile, allowStale: false });
    const rebuilt = JSON.parse(await readFile(materialized.file, 'utf8'));
    expect(registryContentHash(rebuilt)).toBe(current.generated.content_hash);
    expect(rebuilt.plugins).toEqual(current.plugins);

    const direct = await loadDistributedPackage(join(out, 'index.json'), 'plugin', 'alpha', { cacheFile });
    expect(direct.source).toBe('shard-projection');
    expect(direct.record.key).toBe('plugin:alpha');
    expect(direct.record.entries[0].package.source.commit).toBe('c'.repeat(40));
  });

  it('uses a conditional index request, zero repeated shard downloads, and API-to-shard package fallback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-registry-distribution-http-'));
    const out = join(root, 'public', 'distribution-v1');
    const current = registry([packageRecord('alpha', 'plugin', 'a'), packageRecord('beta', 'plugin', 'b'), packageRecord('gamma', 'mcp', 'c')]);
    await writeRegistryDistribution(current, out, { concurrency: 4 });
    const index = JSON.parse(await readFile(join(out, 'index.json'), 'utf8'));
    let indexRequests = 0;
    let shardRequests = 0;
    let endpointRequests = 0;

    const server = createServer(async (req, res) => {
      try {
        const path = String(req.url || '/').replace(/^\/+/, '');
        if (path.startsWith('api/v1/registry/packages/')) {
          endpointRequests += 1;
          res.writeHead(404); res.end(); return;
        }
        if (path === 'distribution-v1/index.json') {
          indexRequests += 1;
          if (req.headers['if-none-match'] === index.etag) { res.writeHead(304, { ETag: index.etag }); res.end(); return; }
          res.writeHead(200, { 'Content-Type': 'application/json', ETag: index.etag });
          res.end(await readFile(join(out, 'index.json'))); return;
        }
        if (path.startsWith('distribution-v1/shards/')) shardRequests += 1;
        const file = resolve(dirname(out), path.replace(/^distribution-v1\//, 'distribution-v1/'));
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(await readFile(file));
      } catch { res.writeHead(404); res.end(); }
    });
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    const source = `http://127.0.0.1:${address.port}/distribution-v1/index.json`;
    const cacheFile = join(root, 'registry-v3.json');

    const first = await materializeRegistryDistribution(source, { cacheFile, allowStale: false, timeout: 5000, shardConcurrency: 16 });
    expect(first.cache_hit).toBe(false);
    expect(shardRequests).toBe(256);
    const firstShardRequests = shardRequests;
    const second = await materializeRegistryDistribution(source, { cacheFile, allowStale: false, timeout: 5000, shardConcurrency: 16 });
    expect(second.cache_hit).toBe(true);
    expect(indexRequests).toBe(2);
    expect(shardRequests).toBe(firstShardRequests);

    const projected = await loadDistributedPackage(source, 'plugin', 'alpha', { cacheFile, allowStale: false, timeout: 5000 });
    expect(endpointRequests).toBe(1);
    expect(projected.source).toBe('shard-projection');
    expect(projected.record.entries[0].package.id).toBe('alpha');
  });

  it('falls back to the legacy full Registry V3 when distribution retrieval fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-registry-distribution-fallback-'));
    const current = registry([packageRecord('legacy-ok', 'plugin', 'e')]);
    const server = createServer((req, res) => {
      if (req.url === '/distribution-v1/index.json') { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'distribution unavailable' })); return; }
      if (req.url === '/registry-v3.json') { res.writeHead(200, { 'Content-Type': 'application/json', ETag: '"legacy-v3"' }); res.end(JSON.stringify(current)); return; }
      res.writeHead(404); res.end();
    });
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    const cacheFile = join(root, 'registry-v3.json');
    const source = `http://127.0.0.1:${address.port}/distribution-v1/index.json`;
    const legacySource = `http://127.0.0.1:${address.port}/registry-v3.json`;
    const file = await ensureRegistryCache(source, { cacheFile, legacySource, allowStale: false, timeout: 5000 });
    const loaded = JSON.parse(await readFile(file, 'utf8'));
    expect(loaded.registry_version).toBe(3);
    expect(loaded.plugins[0].id).toBe('legacy-ok');
  });
});
