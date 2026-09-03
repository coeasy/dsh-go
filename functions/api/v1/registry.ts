import { internalError, type Env } from '../../_lib';

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'If-None-Match, Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  try {
    const asset = await env.ASSETS.fetch(new URL('/catalog/registry-v3.json', request.url));
    if (!asset.ok) {
      return new Response(JSON.stringify({ error: { code: asset.status, message: 'registry unavailable' } }), {
        status: asset.status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
      });
    }
    const headers = new Headers(asset.headers);
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
    headers.set('X-Registry-Version', '3');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(asset.body, { status: 200, headers });
  } catch (cause) {
    return internalError(cause);
  }
};
