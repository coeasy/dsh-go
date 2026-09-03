import { error, json, type Env } from '../../_lib';
import { ecosystemType, loadRegistryV3 } from '../../_registry';
import { loadLocalizationOverlay, packageDetailV2, requestedLocale } from '../../_marketplace-v4';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const id = url.searchParams.get('id')?.toLowerCase();
  const type = url.searchParams.get('type');
  if (!id) return error(400, 'id is required');
  const { data } = await loadRegistryV3(env, request.url);
  const matches = data.plugins
    .filter((plugin) => plugin.id.toLowerCase() === id && (!type || ecosystemType(plugin) === type))
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  if (!matches.length) return error(404, `package not found: ${id}`);
  const types = [...new Set(matches.map(ecosystemType))];
  if (!type && types.length > 1) return error(409, `ambiguous package type: ${types.join(', ')}`);
  const locale = requestedLocale(request);
  const overlay = await loadLocalizationOverlay(env, request.url, locale);
  return json({
    version: 2,
    locale,
    package: { key: `${ecosystemType(matches[0])}:${matches[0].id}`, id: matches[0].id, type: ecosystemType(matches[0]) },
    releases: matches.map((plugin) => packageDetailV2(plugin, overlay)),
    install_execution: false,
  }, { headers: { 'Cache-Control': 'public, max-age=300' } });
};
