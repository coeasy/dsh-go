// GET /api/v1/search?q=关键词 —— 快速搜索（语义化别名）
import { loadCatalog, filterPlugins, parseQuery, json, error, internalError, isNotModified, notModifiedResponse, type Env } from '../../_lib';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get('q') || url.searchParams.get('search') || '';
    if (!q) return error(400, 'search query "q" is required');

    const { data, etag } = await loadCatalog(env);
    if (isNotModified(request, etag)) return notModifiedResponse(etag);

    const limitRaw = parseInt(url.searchParams.get('limit') || '20', 10);
    // 钳制到 [1,100]，避免负数导致 slice 语义错误
    const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 20, 100));
    const matched = filterPlugins(data.plugins, { ...parseQuery(url), search: q });
    const results = matched.slice(0, limit);

    return json(
      {
        query: q,
        total: matched.length,
        results: results.map((p) => ({
          slug: p.slug, name: p.name, full_name: p.full_name, category: p.category,
          description: p.description, stars: p.stars, verified: p.verified,
          install_cmd: p.install_cmd, repo_url: p.repo_url,
        })),
        meta: { updated_at: data.meta.updated_at },
      },
      { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' } },
      etag
    );
  } catch (e) {
    return internalError(e);
  }
};
