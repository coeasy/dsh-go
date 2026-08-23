// GET /api/v1/health —— 健康检查
import { loadCatalog, json, type Env } from '../../_lib';

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const { data } = await loadCatalog(env);
    return json({
      status: 'ok',
      version: 2,
      updated_at: data.meta.updated_at,
      count: data.meta.count,
      source: 'static',
    });
  } catch (e) {
    return json(
      { status: 'error', message: e instanceof Error ? e.message : 'catalog unavailable' },
      { status: 503 }
    );
  }
};
