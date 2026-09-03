import { json, type Env } from '../../_lib';
import { loadRegistryV3 } from '../../_registry';
import { loadLocalizationOverlay, marketplaceHome, requestedLocale } from '../../_marketplace-v4';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { data, etag } = await loadRegistryV3(env, request.url);
  const locale = requestedLocale(request);
  const overlay = await loadLocalizationOverlay(env, request.url, locale);
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit')) || 40, 100));
  const packages = marketplaceHome(data, overlay, limit);
  return json({
    version: 4,
    locale,
    registry: { version: data.registry_version, content_hash: data.generated?.content_hash || null, etag },
    packages,
    trust_is_popularity: false,
    install_execution: false,
  }, { headers: { ETag: `"marketplace-v4-${etag}-${locale}"`, 'Cache-Control': 'public, max-age=300' } });
};
