// GET /api/v1/stats —— 聚合统计
import { loadCatalog, json, internalError, type Env } from '../../_lib';

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const { data, etag } = await loadCatalog(env);
    const plugins = data.plugins;

    const topByStars = [...plugins].sort((a, b) => b.stars - a.stars).slice(0, 10)
      .map((p) => ({ slug: p.slug, name: p.name, stars: p.stars, category: p.category }));
    const topTrending = [...plugins].sort((a, b) => b.trend_score - a.trend_score).slice(0, 10)
      .map((p) => ({ slug: p.slug, name: p.name, trend_score: p.trend_score, stars: p.stars }));

    return json(
      {
        stats: data.meta.stats,
        top_by_stars: topByStars,
        top_trending: topTrending,
        meta: { updated_at: data.meta.updated_at },
      },
      { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' } },
      etag
    );
  } catch (e) {
    return internalError(e);
  }
};
