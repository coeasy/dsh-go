// GET /api/v1/meta — catalog + Registry V3 sync metadata.
import { loadCatalog, filterPlugins, json, internalError, optionsResponse, type Env } from '../../_lib';

interface SyncMeta {
  last_sync?: unknown;
  registry_version?: number;
  registry?: unknown;
  pipeline?: unknown;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { data, etag } = await loadCatalog(env);
    const activeCount = filterPlugins(data.plugins, {}).length;
    let syncMeta: SyncMeta = {};
    try {
      const res = await env.ASSETS.fetch(new URL('/catalog/meta.json', request.url));
      if (res.ok) syncMeta = (await res.json()) as SyncMeta;
    } catch { /* static metadata is optional for legacy API availability */ }

    return json({
      name: 'DSH Go API',
      product_version: '0.1.0',
      runtime_version: '0.1.0',
      api_version: 'v1',
      version: 'v1',
      data_version: data.version,
      registry_version: syncMeta.registry_version || null,
      updated_at: data.meta.updated_at,
      count: data.meta.count,
      active_count: activeCount,
      inactive_count: data.meta.count - activeCount,
      etag,
      source: 'static',
      last_sync: syncMeta.last_sync || null,
      registry: syncMeta.registry || null,
      pipeline: syncMeta.pipeline || null,
      endpoints: [
        '/api/v1', '/api/v1/capabilities', '/api/v1/plugins', '/api/v1/plugins/:slug', '/api/v1/categories',
        '/api/v1/stats', '/api/v1/search', '/api/v1/meta', '/api/v1/health',
        '/api/v1/registry', '/api/v1/registry/delta', '/api/v1/registry/packages/:type/:id',
        '/api/v1/registry/packages/:type/:id/versions', '/api/v1/ecosystem', '/api/v1/ecosystem/:id?type=...',
        '/api/v1/marketplace', '/api/v1/package-detail?id=:id&type=:type',
        '/api/v1/install-plan?id=:id&type=:type', '/api/v1/advisories',
        '/api/v1/publishers/:id', '/api/v1/profiles', '/api/v1/bundles',
        '/api/v1/providers', '/api/v1/providers/:id', '/api/v1/mcp',
      ],
    });
  } catch (error) { return internalError(error); }
};

export const onRequestOptions: PagesFunction = () => optionsResponse();
