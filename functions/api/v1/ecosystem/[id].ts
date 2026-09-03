import { error, internalError, isNotModified, json, notModifiedResponse, type Env } from '../../../_lib';
import { ECOSYSTEM_TYPES, ecosystemType, loadRegistryV3, toEcosystemItem, type EcosystemType } from '../../../_registry';

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const id = String(params.id || '').toLocaleLowerCase();
    const url = new URL(request.url);
    const rawType = (url.searchParams.get('type') || '').toLocaleLowerCase();
    const requestedType = rawType ? rawType as EcosystemType : undefined;
    if (requestedType && !ECOSYSTEM_TYPES.includes(requestedType)) return error(400, `invalid ecosystem type: ${rawType}`);

    const { data, etag } = await loadRegistryV3(env, request.url);
    const matches = data.plugins.filter((plugin) => {
      const pluginId = plugin.id.toLocaleLowerCase();
      const repo = String(plugin.source?.repo || '').toLocaleLowerCase();
      return (pluginId === id || repo === id)
        && (!requestedType || ecosystemType(plugin) === requestedType);
    });
    if (!matches.length) return error(404, `ecosystem item not found: ${requestedType ? `${requestedType}:` : ''}${id}`);
    if (!requestedType) {
      const types = [...new Set(matches.map(ecosystemType))];
      if (types.length > 1) {
        return error(409, `ecosystem item id is ambiguous; retry the same /api/v1 route with ?type=${types.join('|')}`);
      }
    }
    if (isNotModified(request, etag)) return notModifiedResponse(etag);

    const selectedType = requestedType || ecosystemType(matches[0]);
    const typedMatches = matches.filter((plugin) => ecosystemType(plugin) === selectedType);
    return json({
      item: toEcosystemItem(typedMatches[0]),
      versions: typedMatches.map((plugin) => ({ version: plugin.version, commit: plugin.source.commit })),
      meta: { api_version: 'v1', registry_version: data.registry_version, generated_at: data.generated?.at, etag },
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
