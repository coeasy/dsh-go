import type { Env } from '../../../../../_lib';

const FORMAT = 'dsh-registry-distribution';
const TYPES = new Set(['plugin', 'mcp', 'skill', 'agent']);
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,199}$/;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function response(body: unknown, status = 200, etag?: string): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
    'Cache-Control': status === 200 ? 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400' : 'no-store',
    'X-Api-Version': 'v1',
    'X-Content-Type-Options': 'nosniff',
  });
  if (etag) headers.set('ETag', etag);
  return new Response(status === 304 ? null : JSON.stringify(body), { status, headers });
}

function packageType(record: any): string {
  const value = String(record?.runtime?.type || 'plugin').toLowerCase();
  return TYPES.has(value) ? value : 'plugin';
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const type = String(params.type || '').toLowerCase();
    const id = String(params.id || '').trim().toLowerCase();
    if (!TYPES.has(type) || !ID_PATTERN.test(id) || id.includes('..')) return response({ error: { code: 400, message: 'invalid package identity' } }, 400);
    const key = `${type}:${id}`;

    const indexResponse = await env.ASSETS.fetch(new URL('/catalog/distribution-v1/index.json', request.url));
    if (!indexResponse.ok) throw new Error(`distribution index unavailable: ${indexResponse.status}`);
    const index: any = await indexResponse.json();
    if (index?.format !== FORMAT || index?.distribution_version !== 1 || index?.registry_version !== 3 || !Array.isArray(index?.shards)) {
      throw new Error('invalid distribution index');
    }
    const descriptor = index.packages?.[key];
    if (!descriptor) return response({ error: { code: 404, message: `package not found: ${key}` } }, 404);
    const expectedPrefix = (await sha256(key)).slice(0, 2);
    if (!/^[0-9a-f]{2}$/.test(String(descriptor.prefix || '')) || descriptor.prefix !== expectedPrefix) throw new Error('invalid package shard prefix');
    const shardDescriptor = index.shards.find((item: any) => item?.prefix === descriptor.prefix);
    if (!shardDescriptor || shardDescriptor.path !== `shards/${descriptor.prefix}.json`) throw new Error('package shard descriptor missing');

    const shardResponse = await env.ASSETS.fetch(new URL(`/catalog/distribution-v1/shards/${descriptor.prefix}.json`, request.url));
    if (!shardResponse.ok) throw new Error(`distribution shard unavailable: ${shardResponse.status}`);
    const shard: any = await shardResponse.json();
    if (shard?.format !== FORMAT || shard?.distribution_version !== 1 || shard?.registry_version !== 3 || shard?.prefix !== descriptor.prefix || !Array.isArray(shard?.entries)) {
      throw new Error('invalid distribution shard');
    }
    const shardHash = await sha256(stableStringify(shard.entries));
    if (shardHash !== shardDescriptor.content_hash || shard.content_hash !== shardDescriptor.content_hash) throw new Error('distribution shard integrity mismatch');

    const entries = shard.entries.filter((entry: any) => packageType(entry?.package) === type && String(entry?.package?.id || '').trim().toLowerCase() === id);
    if (!entries.length) return response({ error: { code: 404, message: `package not found: ${key}` } }, 404);
    const contentHash = await sha256(stableStringify(entries.map((entry: any) => entry.package)));
    if (contentHash !== descriptor.content_hash || entries.length !== descriptor.count) throw new Error('package projection integrity mismatch');
    const etag = descriptor.etag || `"sha256-${contentHash}"`;
    const ifNoneMatch = request.headers.get('If-None-Match');
    if (ifNoneMatch === etag || ifNoneMatch === '*') return response(null, 304, etag);

    return response({
      format: FORMAT,
      distribution_version: 1,
      registry_version: 3,
      key,
      type,
      id: entries[0].package.id,
      count: entries.length,
      content_hash: contentHash,
      etag,
      entries,
    }, 200, etag);
  } catch (error) {
    console.error('[registry-package] projection failed:', error);
    return response({ error: { code: 500, message: 'internal server error' } }, 500);
  }
};

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
    'Access-Control-Max-Age': '86400',
  },
});
