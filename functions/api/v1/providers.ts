import { error, internalError, isNotModified, json, notModifiedResponse, paginate } from '../../_lib';
import { filterProviderAdapters, loadProviderAdapterMarketplace, toProviderMarketplaceItem } from '../../_providers';

export const onRequestGet: PagesFunction = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const { data, etag } = await loadProviderAdapterMarketplace(request.url);
    if (isNotModified(request, etag)) return notModifiedResponse(etag);
    const kind = url.searchParams.get('kind') || undefined;
    if (kind && !['llm', 'mcp', 'skill', 'agent-runtime'].includes(kind)) return error(400, 'unsupported provider adapter kind');
    const channel = url.searchParams.get('channel') || undefined;
    if (channel && !['stable', 'beta', 'nightly', 'dev'].includes(channel)) return error(400, 'unsupported provider adapter channel');
    const filtered = filterProviderAdapters(data.providers, {
      kind,
      channel,
      capability: url.searchParams.get('capability') || undefined,
      search: url.searchParams.get('search') || url.searchParams.get('q') || undefined,
    });
    const page = Number.parseInt(url.searchParams.get('page') || '1', 10);
    const perPage = Number.parseInt(url.searchParams.get('per_page') || '50', 10);
    const { items, pagination } = paginate(filtered, page, perPage);
    return json({
      meta: {
        registry_version: data.registry_version,
        schema_version: data.schema_version,
        generated_at: data.generated.at,
        content_hash: data.generated.content_hash,
        count: data.generated.count,
        release_count: data.generated.release_count,
        filtered_count: filtered.length,
        etag,
      },
      pagination,
      items: items.map((item) => toProviderMarketplaceItem(item, channel || 'stable')),
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
