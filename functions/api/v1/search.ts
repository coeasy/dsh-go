// GET /api/v1/search?q=关键词&type=plugin|mcp|skill|agent&verified=true
import { error, internalError, isNotModified, json, notModifiedResponse, type Env } from '../../_lib';
import { ECOSYSTEM_TYPES, filterEcosystem, loadRegistryV3, toEcosystemItem, type EcosystemType } from '../../_registry';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get('q') || url.searchParams.get('search') || '';
    const rawType = (url.searchParams.get('type') || '').toLowerCase();
    if (rawType && !ECOSYSTEM_TYPES.includes(rawType as EcosystemType)) return error(400, `invalid ecosystem type: ${rawType}`);
    const verifiedRaw = url.searchParams.get('verified');
    if (verifiedRaw && !['true', 'false'].includes(verifiedRaw)) return error(400, 'verified must be true or false');
    const verified = verifiedRaw === 'true' ? true : verifiedRaw === 'false' ? false : undefined;
    const limitRaw = Number.parseInt(url.searchParams.get('limit') || '20', 10);
    const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 20, 100));

    const { data, etag } = await loadRegistryV3(env, request.url);
    if (isNotModified(request, etag)) return notModifiedResponse(etag);
    const matched = filterEcosystem(data.plugins, {
      search: q || undefined,
      type: rawType || undefined,
      verified,
      channel: url.searchParams.get('channel') || undefined,
      capability: url.searchParams.get('capability') || undefined,
    });
    const items = matched.slice(0, limit).map(toEcosystemItem);

    return json({
      query: q,
      total: matched.length,
      results: items.map((item) => ({
        id: item.id,
        key: item.key,
        type: item.type,
        version: item.version,
        channel: item.channel,
        name: item.name,
        description: item.description,
        verified: item.verified,
        stars: Number(item.metadata?.stars || 0),
        category: item.metadata?.category || 'other',
        repo: item.source.repo,
        repo_url: item.metadata?.repo_url || `https://github.com/${item.source.repo}`,
        capabilities: item.capabilities,
        permissions: item.permissions,
        install_cmd: item.local_install.command,
        deep_link: item.local_install.deep_link,
        // Legacy plugin-oriented consumers can continue to read these aliases.
        slug: item.id,
        full_name: item.source.repo,
      })),
      meta: {
        api_version: 'v1',
        registry_version: data.registry_version,
        generated_at: data.generated?.at,
        etag,
      },
    }, { headers: { 'Cache-Control': 'public, max-age=120, s-maxage=120' } }, etag);
  } catch (cause) {
    return internalError(cause);
  }
};
