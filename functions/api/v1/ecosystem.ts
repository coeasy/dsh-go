import { error, internalError, isNotModified, json, notModifiedResponse, paginate, type Env } from '../../_lib';
import { ECOSYSTEM_TYPES, ecosystemType, filterEcosystem, loadRegistryV3, toEcosystemItem, type EcosystemType } from '../../_registry';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const verifiedParam = url.searchParams.get('verified');
    if (verifiedParam && !['true', 'false'].includes(verifiedParam)) return error(400, 'verified must be true or false');
    const rawType = (url.searchParams.get('type') || '').toLowerCase();
    if (rawType && !ECOSYSTEM_TYPES.includes(rawType as EcosystemType)) return error(400, `invalid ecosystem type: ${rawType}`);
    const rawChannel = (url.searchParams.get('channel') || '').toLowerCase();
    if (rawChannel && !['stable', 'beta', 'nightly', 'dev'].includes(rawChannel)) return error(400, `invalid release channel: ${rawChannel}`);
    const { data, etag } = await loadRegistryV3(env, request.url);
    if (isNotModified(request, etag)) return notModifiedResponse(etag);

    const query = {
      type: rawType || undefined,
      channel: rawChannel || undefined,
      capability: url.searchParams.get('capability') || undefined,
      search: url.searchParams.get('search') || url.searchParams.get('q') || undefined,
      verified: verifiedParam === 'true' ? true : verifiedParam === 'false' ? false : undefined,
    };
    const filtered = filterEcosystem(data.plugins, query);
    const page = Number.parseInt(url.searchParams.get('page') || '1', 10);
    const perPage = Number.parseInt(url.searchParams.get('per_page') || '50', 10);
    const { items, pagination } = paginate(filtered, page, perPage);
    const typeCounts = Object.fromEntries(['plugin', 'mcp', 'skill', 'agent'].map((type) => [
      type,
      data.plugins.filter((plugin) => ecosystemType(plugin) === type).length,
    ]));

    return json({
      meta: {
        registry_version: data.registry_version,
        schema_version: data.schema_version,
        generated_at: data.generated?.at,
        count: data.plugins.length,
        filtered_count: filtered.length,
        type_counts: typeCounts,
        etag,
      },
      pagination,
      items: items.map(toEcosystemItem),
    }, { headers: { 'Cache-Control': 'public, max-age=120, s-maxage=120' } }, etag);
  } catch (cause) {
    return internalError(cause);
  }
};

export const onRequestOptions: PagesFunction = () =>
  new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
      'Access-Control-Max-Age': '86400',
    },
  });
