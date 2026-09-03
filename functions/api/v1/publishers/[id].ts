import { error, json, type Env } from '../../../_lib';
import { loadRegistryV3 } from '../../../_registry';
import { loadLocalizationOverlay, publisherSummary, requestedLocale } from '../../../_marketplace-v4';

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id || '');
  if (!id) return error(400, 'publisher id is required');
  const { data } = await loadRegistryV3(env, request.url);
  const locale = requestedLocale(request);
  const overlay = await loadLocalizationOverlay(env, request.url, locale);
  const publisher = publisherSummary(data, id, overlay);
  if (!publisher.packages.length) return error(404, `publisher not found: ${id}`);
  return json({ version: 1, locale, publisher, trust_is_popularity: false, install_execution: false }, { headers: { 'Cache-Control': 'public, max-age=300' } });
};
