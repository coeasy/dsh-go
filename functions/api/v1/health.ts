// GET /api/v1/health — catalog + Registry V3 availability.
import { loadCatalog, json, type Env } from '../../_lib';

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const { data } = await loadCatalog(env);
    const registryResponse = await env.ASSETS.fetch(new URL('/catalog/registry-v3.json', 'https://dsh-go.pages.dev'));
    if (!registryResponse.ok) throw new Error(`registry unavailable: ${registryResponse.status}`);
    const registry = (await registryResponse.json()) as {
      registry_version?: number;
      generated?: { content_hash?: string; count?: number };
      plugins?: unknown[];
    };
    if (registry.registry_version !== 3 || !registry.generated?.content_hash || !registry.plugins?.length) throw new Error('registry integrity metadata missing');
    return json({
      status: 'ok', catalog_version: data.version, registry_version: registry.registry_version,
      updated_at: data.meta.updated_at, count: data.meta.count, registry_count: registry.plugins.length,
      registry_hash: registry.generated.content_hash, source: 'static',
    });
  } catch (error) {
    return json({ status: 'error', message: error instanceof Error ? error.message : 'catalog/registry unavailable' }, { status: 503 });
  }
};
