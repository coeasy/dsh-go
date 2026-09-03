// GET /api/v1/stats —— 聚合统计
import { loadCatalog, filterPlugins, json, internalError, optionsResponse, type Env } from '../../_lib';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { data, etag } = await loadCatalog(env);
    const includeDeprecated = new URL(request.url).searchParams.get('include_deprecated') === 'true';
    const plugins = filterPlugins(data.plugins, { include_deprecated: includeDeprecated });
    const byCategory: Record<string, number> = {};
    const byLanguage: Record<string, number> = {};
    const byLicense: Record<string, number> = {};
    let verified = 0;
    for (const plugin of plugins) {
      byCategory[plugin.category || 'other'] = (byCategory[plugin.category || 'other'] || 0) + 1;
      if (plugin.language) byLanguage[plugin.language] = (byLanguage[plugin.language] || 0) + 1;
      if (plugin.license) byLicense[plugin.license] = (byLicense[plugin.license] || 0) + 1;
      if (plugin.verified) verified++;
    }
    const stats = { total: plugins.length, verified, by_category: byCategory, by_language: byLanguage, by_license: byLicense };

    const topByStars = [...plugins].sort((a, b) => b.stars - a.stars).slice(0, 10)
      .map((p) => ({ slug: p.slug, name: p.name, stars: p.stars, category: p.category }));
    const topTrending = [...plugins].sort((a, b) => b.trend_score - a.trend_score).slice(0, 10)
      .map((p) => ({ slug: p.slug, name: p.name, trend_score: p.trend_score, stars: p.stars }));

    return json(
      {
        stats,
        top_by_stars: topByStars,
        top_trending: topTrending,
        meta: { updated_at: data.meta.updated_at, catalog_total: data.meta.count },
      },
      { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' } },
      etag
    );
  } catch (e) {
    return internalError(e);
  }
};

export const onRequestOptions: PagesFunction = () => optionsResponse();
