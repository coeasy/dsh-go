import { error, internalError, isNotModified, json, notModifiedResponse, type Env } from '../../../_lib';
import { loadProviderAdapterMarketplace, toProviderMarketplaceItem } from '../../../_providers';

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const id = (Array.isArray(params.id) ? params.id[0] : String(params.id || '')).trim();
    if (!id) return error(400, 'provider adapter id is required');
    const url = new URL(request.url);
    const channel = url.searchParams.get('channel')?.trim().toLowerCase() || 'stable';
    if (!['stable', 'beta', 'nightly', 'dev'].includes(channel)) return error(400, 'unsupported provider adapter channel');
    const { data, etag } = await loadProviderAdapterMarketplace(request.url, (input, init) => env.ASSETS.fetch(input, init));
    if (isNotModified(request, etag)) return notModifiedResponse(etag);
    const group = data.providers.find((item) => item.id.toLowerCase() === id.toLowerCase());
    if (!group) return error(404, 'provider adapter not found');
    if (!group.channels?.[channel]) return error(404, `provider adapter channel not found: ${channel}`);
    return json({
      item: toProviderMarketplaceItem(group, channel),
      channels: group.channels,
      versions: group.versions,
    }, { headers: { 'Cache-Control': 'public, max-age=120, s-maxage=120' } }, etag);
  } catch (cause) {
    return internalError(cause);
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
