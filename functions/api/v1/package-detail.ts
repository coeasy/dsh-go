import { error, internalError, json, optionsResponse, type Env } from '../../_lib';
import { ecosystemType, loadRegistryV3 } from '../../_registry';
import { compareSemanticVersions, normalizeEdgePackageRequest, satisfiesSemanticVersion } from '../../_package-request';
import { loadLocalizationOverlay, packageDetailV2, requestedLocale } from '../../_marketplace-v4';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id')?.trim().toLowerCase();
    const rawType = url.searchParams.get('type')?.trim().toLowerCase() || '';
    const rawVersion = url.searchParams.get('version')?.trim() || '';
    const rawChannel = url.searchParams.get('channel')?.trim().toLowerCase() || '';
    let normalized;
    try {
      normalized = normalizeEdgePackageRequest({
        id,
        type: rawType || undefined,
        version: rawVersion || undefined,
        channel: rawChannel || undefined,
      });
    } catch (cause) {
      return error(400, cause instanceof Error ? cause.message : 'invalid package request');
    }
    const type = normalized.type;
    const { data } = await loadRegistryV3(env, request.url);
    const matches = data.plugins
      .filter((plugin) => {
        const pluginId = plugin.id.toLowerCase();
        const repo = String(plugin.source?.repo || '').toLowerCase();
        return (pluginId === normalized.id.toLowerCase() || repo === normalized.id.toLowerCase())
          && (!type || ecosystemType(plugin) === type)
          && (!rawChannel || (plugin.channel || plugin.release_channel || 'stable') === normalized.channel)
          && (!rawVersion || satisfiesSemanticVersion(plugin.version, normalized.versionRange));
      })
      .sort((a, b) => compareSemanticVersions(b.version, a.version));
    if (!matches.length) return error(404, `package not found: ${normalized.id}`);
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
  } catch (cause) {
    return internalError(cause);
  }
};

export const onRequestOptions: PagesFunction = () => optionsResponse();
