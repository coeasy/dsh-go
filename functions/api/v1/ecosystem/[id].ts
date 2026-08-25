import { error, internalError, isNotModified, json, notModifiedResponse, type Env } from '../../../_lib';
import { loadRegistryV3, toEcosystemItem } from '../../../_registry';

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const id = String(params.id || '').toLocaleLowerCase();
    const { data, etag } = await loadRegistryV3(env, request.url);
    if (isNotModified(request, etag)) return notModifiedResponse(etag);
    const matches = data.plugins.filter((plugin) => plugin.id.toLocaleLowerCase() === id);
    if (!matches.length) return error(404, `ecosystem item not found: ${id}`);
    return json({
      item: toEcosystemItem(matches[0]),
      versions: matches.map((plugin) => ({ version: plugin.version, commit: plugin.source.commit })),
      meta: { registry_version: data.registry_version, generated_at: data.generated?.at, etag },
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
