// GET /api/v2/search?q=...&type=plugin|mcp|skill|agent&verified=true&limit=50
import type { Env } from '../../_lib';

type SearchItem = {
  id: string;
  type: 'plugin' | 'mcp' | 'skill' | 'agent';
  version: string;
  name: string;
  description: string;
  category: string;
  verified: boolean;
  stars: number;
  capabilities: string[];
  permissions: string[];
  repo: string;
  tokens: string[];
};

type SearchIndex = {
  version: number;
  generated_at: string;
  registry_hash: string;
  hash: string;
  count: number;
  items: SearchItem[];
};

function response(body: unknown, status = 200, etag?: string) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=120, s-maxage=120',
    'X-Api-Version': 'v2',
    'X-Content-Type-Options': 'nosniff',
  });
  if (etag) headers.set('ETag', `"${etag}"`);
  return new Response(JSON.stringify(body), { status, headers });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const type = url.searchParams.get('type') || '';
    const verified = url.searchParams.get('verified');
    const rawLimit = Number.parseInt(url.searchParams.get('limit') || '50', 10);
    const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 50, 200));
    if (type && !['plugin', 'mcp', 'skill', 'agent'].includes(type)) return response({ error: { code: 400, message: 'invalid ecosystem type' } }, 400);

    const asset = await env.ASSETS.fetch(new URL('/catalog/search-index-v2.json', request.url));
    if (!asset.ok) throw new Error(`search index load failed: ${asset.status}`);
    const index = (await asset.json()) as SearchIndex;
    const requestEtag = request.headers.get('If-None-Match')?.replace(/^"|"$/g, '');
    if (requestEtag && requestEtag === index.hash) return new Response(null, { status: 304, headers: { ETag: `"${index.hash}"`, 'Access-Control-Allow-Origin': '*', 'X-Api-Version': 'v2' } });

    const matched = index.items.filter((item) => {
      if (type && item.type !== type) return false;
      if (verified === 'true' && !item.verified) return false;
      if (verified === 'false' && item.verified) return false;
      if (!q) return true;
      return item.tokens.some((token) => token.includes(q)) || item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q) || item.repo.toLowerCase().includes(q);
    });
    matched.sort((a, b) => b.stars - a.stars || a.name.localeCompare(b.name));

    return response({
      query: q,
      type: type || 'all',
      total: matched.length,
      results: matched.slice(0, limit),
      meta: { provider: 'static', index_version: index.version, registry_hash: index.registry_hash, generated_at: index.generated_at },
    }, 200, index.hash);
  } catch (error) {
    console.error('[dsh-go] search v2 error:', error);
    return response({ error: { code: 500, message: 'internal server error' } }, 500);
  }
};
