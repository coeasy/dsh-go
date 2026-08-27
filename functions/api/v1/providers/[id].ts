import { error, internalError, isNotModified, json, notModifiedResponse } from '../../../_lib';
import { loadProviderAdapterMarketplace, toProviderMarketplaceItem } from '../../../_providers';

export const onRequestGet: PagesFunction = async ({ request, params }) => {
  try {
    const id = Array.isArray(params.id) ? params.id[0] : String(params.id || '');
    if (!id) return error(400, 'provider adapter id is required');
    const url = new URL(request.url);
    const { data, etag } = await loadProviderAdapterMarketplace(request.url);
    if (isNotModified(request, etag)) return notModifiedResponse(etag);
    const group = data.providers.find((item) => item.id.toLowerCase() === id.toLowerCase());
    if (!group) return error(404, 'provider adapter not found');
    const channel = url.searchParams.get('channel') || 'stable';
    if (!['stable', 'beta', 'nightly', 'dev'].includes(channel)) return error(400, 'unsupported provider adapter channel');
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
