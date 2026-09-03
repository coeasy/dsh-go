import { error, json, type Env } from '../../_lib';
import { ecosystemType, loadRegistryV3 } from '../../_registry';
import { loadLocalizationOverlay, packageDetailV2, requestedLocale } from '../../_marketplace-v4';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const type = url.searchParams.get('type');
  const version = url.searchParams.get('version');
  const channel = url.searchParams.get('channel') || 'stable';
  if (!id) return error(400, 'id is required');
  const { data } = await loadRegistryV3(env, request.url);
  let matches = data.plugins.filter((plugin) => plugin.id.toLowerCase() === id.toLowerCase());
  if (type) matches = matches.filter((plugin) => ecosystemType(plugin) === type);
  matches = matches.filter((plugin) => (plugin.channel || plugin.release_channel || 'stable') === channel);
  if (version) matches = matches.filter((plugin) => plugin.version === version);
  matches = matches.filter((plugin) => (plugin.security as any)?.yanked !== true && (plugin.security as any)?.revoked !== true);
  matches.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  if (!matches.length) return error(404, `installable package not found: ${id}`);
  const types = [...new Set(matches.map(ecosystemType))];
  if (!type && types.length > 1) return error(409, `ambiguous package type: ${types.join(', ')}`);
  const locale = requestedLocale(request);
  const overlay = await loadLocalizationOverlay(env, request.url, locale);
  const detail = packageDetailV2(matches[0], overlay);
  return json({
    request: { id, type: type || detail.identity.type, version: version || '*', channel },
    resolved: detail.identity,
    presentation: detail.presentation,
    trust: detail.trust,
    permissions: detail.permissions,
    dependencies: detail.dependencies,
    local_install: detail.local_install,
    executed: false,
    remote_mutation_supported: false,
  });
};
