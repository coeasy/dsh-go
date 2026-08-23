// GET /api/v1/plugins/:slug —— 单个插件详情
import { loadCatalog, json, error, internalError, isNotModified, notModifiedResponse, type Env } from '../../../_lib';

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const slug = String(params.slug || '').toLowerCase();
    const { data, etag } = await loadCatalog(env);

    if (isNotModified(request, etag)) return notModifiedResponse(etag);

    const plugin = data.plugins.find((p) => p.slug.toLowerCase() === slug);
    if (!plugin) return error(404, `plugin not found: ${slug}`);

    // 相关插件：同分类的 Top 6
    const related = data.plugins
      .filter((p) => p.category === plugin.category && p.slug !== plugin.slug)
      .sort((a, b) => b.stars - a.stars)
      .slice(0, 6)
      .map((p) => ({ slug: p.slug, name: p.name, stars: p.stars, category: p.category }));

    return json(
      {
        plugin,
        related,
        meta: { updated_at: data.meta.updated_at, etag },
      },
      { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' } },
      etag
    );
  } catch (e) {
    return internalError(e);
  }
};

// Pages Functions 约定：导出 onRequestOptions（不要用旧的 OPTIONS 导出，那不会生效）
export const onRequestOptions: PagesFunction = () =>
  new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
      'Access-Control-Max-Age': '86400',
    },
  });
