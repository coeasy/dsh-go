// GET /api/v1/meta — catalog + Registry V3 sync metadata.
import { loadCatalog, filterPlugins, json, internalError, type Env } from '../../_lib';

interface SyncMeta {
  last_sync?: unknown;
  registry_version?: number;
  registry?: unknown;
  pipeline?: unknown;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const { data, etag } = await loadCatalog(env);
    const activeCount = filterPlugins(data.plugins, {}).length;
    let syncMeta: SyncMeta = {};
    try {
      const res = await env.ASSETS.fetch(new URL('/catalog/meta.json', 'https://dsh-go.pages.dev'));
      if (res.ok) syncMeta = (await res.json()) as SyncMeta;
    } catch { /* static metadata is optional for legacy API availability */ }

    return json({
      name: 'DSH Go API', version: 'v1', data_version: data.version,
      registry_version: syncMeta.registry_version || null,
      updated_at: data.meta.updated_at, count: data.meta.count, active_count: activeCount, inactive_count: data.meta.count - activeCount, etag, source: 'static',
      last_sync: syncMeta.last_sync || null, registry: syncMeta.registry || null, pipeline: syncMeta.pipeline || null,
      endpoints: [
        '/api/v1/plugins', '/api/v1/plugins/:slug', '/api/v1/categories',
        '/api/v1/stats', '/api/v1/search', '/api/v1/meta', '/api/v1/health',
        '/api/v1/registry', '/api/v1/mcp',
      ],
    });
  } catch (error) { return internalError(error); }
};
