import { json, type Env } from '../../_lib';
import { ecosystemType, loadRegistryV3 } from '../../_registry';
import { trustFor } from '../../_marketplace-v4';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const id = url.searchParams.get('id')?.toLowerCase();
  const type = url.searchParams.get('type');
  const severity = url.searchParams.get('severity')?.toLowerCase();
  const { data } = await loadRegistryV3(env, request.url);
  const advisories = [];
  for (const plugin of data.plugins) {
    const pluginType = ecosystemType(plugin);
    if (id && plugin.id.toLowerCase() !== id) continue;
    if (type && pluginType !== type) continue;
    const security: any = plugin.security || {};
    const entries = Array.isArray(security.advisories) ? security.advisories : [];
    for (const advisory of entries) {
      const level = String(advisory?.severity || 'unknown').toLowerCase();
      if (severity && level !== severity) continue;
      advisories.push({
        package: { key: `${pluginType}:${plugin.id}`, id: plugin.id, type: pluginType, version: plugin.version, repo: plugin.source.repo, commit: plugin.source.commit },
        advisory: { id: advisory?.id || advisory?.advisory_id || 'unknown', severity: level, title: advisory?.title || advisory?.summary || null, affected: advisory?.affected || advisory?.range || '*', fixed_in: advisory?.fixed_in || advisory?.minimum_safe_version || null, url: advisory?.url || null },
        revoked: security.revoked === true,
        yanked: security.yanked === true,
        minimum_safe_version: security.minimum_safe_version || null,
        trust: trustFor(plugin),
      });
    }
    if (security.revoked === true && entries.length === 0) advisories.push({ package: { key: `${pluginType}:${plugin.id}`, id: plugin.id, type: pluginType, version: plugin.version, repo: plugin.source.repo, commit: plugin.source.commit }, advisory: null, revoked: true, yanked: security.yanked === true, minimum_safe_version: security.minimum_safe_version || null, trust: trustFor(plugin) });
  }
  return json({ version: 1, count: advisories.length, advisories, install_execution: false }, { headers: { 'Cache-Control': 'public, max-age=300' } });
};
