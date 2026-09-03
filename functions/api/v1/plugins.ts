// GET /api/v1/plugins —— 插件列表（过滤/搜索/排序/分页）
import {
  loadCatalog, filterPlugins, paginate, parseQuery, json, internalError,
  isNotModified, notModifiedResponse, optionsResponse,
  type Env,
} from '../../_lib';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const { data, etag } = await loadCatalog(env);

    if (isNotModified(request, etag)) return notModifiedResponse(etag);

    const q = parseQuery(url);
    const filtered = filterPlugins(data.plugins, q);
    const { items, pagination } = paginate(filtered, q.page, q.per_page);

    return json(
      {
        meta: {
          updated_at: data.meta.updated_at,
          count: data.meta.count,
          etag,
          filtered_count: filtered.length,
          query: q,
        },
        pagination,
        plugins: items,
      },
      { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' } },
      etag
    );
  } catch (e) {
    return internalError(e);
  }
};

// Pages Functions 约定：导出 onRequestOptions（不要用旧的 OPTIONS 导出，那不会生效）
export const onRequestOptions: PagesFunction = () => optionsResponse();
