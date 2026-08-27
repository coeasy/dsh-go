import { describe, expect, it } from 'vitest';
import { buildRegistryDistribution } from '../../scripts/registry-distribution.mjs';
import { registryContentHash } from '../../scripts/checksum.mjs';
import { onRequestGet } from '../../functions/api/v1/registry/packages/[type]/[id]';

function packageRecord(id: string, type = 'plugin') {
  const commit = 'a'.repeat(40);
  return {
    id, version: '0.1.0',
    source: { provider: 'github', repo: `fixture/${id}`, ref: 'main', commit, archive_url: `https://github.com/fixture/${id}/archive/${commit}.tar.gz` },
    artifact: { kind: 'git-source', algorithm: 'sha256', integrity_scope: 'source-identity', integrity: `sha256-${commit}` },
    runtime: { type, activation: 'restart-required' }, capabilities: [type], dependencies: [], metadata: { name: id },
  };
}
function registry(records: any[]) {
  const value: any = { registry_version: 3, schema_version: '3.0.0', defaults: { plugin_version: '0.1.0' }, generated: { at: '2026-08-26T00:00:00.000Z', count: records.length, content_hash: '' }, plugins: records };
  value.generated.content_hash = registryContentHash(value);
  return value;
}
function fixtureEnv(distribution: any) {
  return {
    ASSETS: {
      fetch: async (input: Request | string | URL) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
        if (url.pathname === '/catalog/distribution-v1/index.json') {
          return new Response(distribution.indexText, { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        const match = url.pathname.match(/^\/catalog\/distribution-v1\/shards\/([0-9a-f]{2})\.json$/);
        if (match && distribution.shardFiles.has(match[1])) {
          return new Response(distribution.shardFiles.get(match[1]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('not found', { status: 404 });
      },
    },
  };
}

async function call(distribution: any, type: string, id: string, ifNoneMatch?: string) {
  const request = new Request(`https://dsh-go.pages.dev/api/v1/registry/packages/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, {
    headers: ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : {},
  });
  return onRequestGet({ request, env: fixtureEnv(distribution), params: { type, id } } as any);
}

describe('Registry package projection API', () => {
  it('projects a package record with the descriptor hash and supports 304', async () => {
    const distribution = buildRegistryDistribution(registry([packageRecord('alpha'), packageRecord('bravo', 'mcp')]));
    const packages = distribution.index.packages as Record<string, { content_hash: string; etag: string }>;
    const first = await call(distribution, 'plugin', 'alpha');
    expect(first.status).toBe(200);
    const body: any = await first.json();
    expect(body.key).toBe('plugin:alpha');
    expect(body.entries).toHaveLength(1);
    expect(body.content_hash).toBe(packages['plugin:alpha'].content_hash);
    const etag = first.headers.get('ETag');
    expect(etag).toBe(packages['plugin:alpha'].etag);
    const second = await call(distribution, 'plugin', 'alpha', etag || undefined);
    expect(second.status).toBe(304);
  });

  it('returns 404 for missing packages and rejects unsafe identities before asset path construction', async () => {
    const distribution = buildRegistryDistribution(registry([packageRecord('alpha')]));
    expect((await call(distribution, 'plugin', 'missing')).status).toBe(404);
    expect((await call(distribution, 'plugin', '../alpha')).status).toBe(400);
    expect((await call(distribution, 'unknown', 'alpha')).status).toBe(400);
  });
});
