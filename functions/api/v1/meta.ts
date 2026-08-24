// GET /api/v1/meta —— 同步元信息（供监控 / 数据新鲜度检查）
import { loadCatalog, json, internalError, type Env } from '../../_lib';

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const { data, etag } = await loadCatalog(env);
    // meta.json 存于静态目录，尽力读取同步历史；读取失败时仅返回 plugins 元信息
    let last_sync = null;
    try {
      const res = await env.ASSETS.fetch(new URL('/catalog/meta.json', 'https://dsh-go.pages.dev'));
      if (res.ok) {
        const m = (await res.json()) as { last_sync?: unknown };
        last_sync = m.last_sync || null;
      }
    } catch { /* ignore */ }

    return json({
      name: 'DSH Go API',
      version: 'v1',
      data_version: data.version,
      updated_at: data.meta.updated_at,
      count: data.meta.count,
      etag,
      source: 'static',
      last_sync,
      endpoints: [
        '/api/v1/plugins', '/api/v1/plugins/:slug', '/api/v1/categories',
        '/api/v1/stats', '/api/v1/search', '/api/v1/meta', '/api/v1/health', '/api/v1/mcp',
      ],
    });
  } catch (e) {
    return internalError(e);
  }
};
