import { error, internalError, json, optionsResponse, type Env } from '../../_lib';
import { ECOSYSTEM_TYPES, ecosystemType, loadRegistryV3, type EcosystemType } from '../../_registry';
import { trustFor } from '../../_marketplace-v4';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id')?.trim().toLowerCase();
    const rawType = url.searchParams.get('type')?.trim().toLowerCase() || '';
    const severity = url.searchParams.get('severity')?.trim().toLowerCase();
    if (id && (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?$/.test(id) || id.split('/').some((part) => part === '.' || part === '..'))) return error(400, `invalid package id: ${id}`);
    if (rawType && !ECOSYSTEM_TYPES.includes(rawType as EcosystemType)) return error(400, `invalid ecosystem type: ${rawType}`);
    if (severity && !['unknown', 'low', 'moderate', 'medium', 'high', 'critical'].includes(severity)) return error(400, `invalid advisory severity: ${severity}`);
    const type = rawType ? rawType as EcosystemType : undefined;
    const { data } = await loadRegistryV3(env, request.url);
    const advisories = [];
    for (const plugin of data.plugins) {
      const pluginType = ecosystemType(plugin);
      const pluginId = plugin.id.toLowerCase();
      const repo = String(plugin.source?.repo || '').toLowerCase();
      if (id && pluginId !== id && repo !== id) continue;
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
      if (entries.length === 0 && (security.revoked === true || security.yanked === true || security.minimum_safe_version)) {
        advisories.push({ package: { key: `${pluginType}:${plugin.id}`, id: plugin.id, type: pluginType, version: plugin.version, repo: plugin.source.repo, commit: plugin.source.commit }, advisory: null, revoked: security.revoked === true, yanked: security.yanked === true, minimum_safe_version: security.minimum_safe_version || null, trust: trustFor(plugin) });
      }
    }
    return json({ version: 1, count: advisories.length, advisories, install_execution: false }, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch (cause) {
    return internalError(cause);
  }
};

export const onRequestOptions: PagesFunction = () => optionsResponse();
