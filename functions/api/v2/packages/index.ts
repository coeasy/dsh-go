import { apiData, apiError, optionsResponse, requestId, statusForError } from '../../../_api-v2';
import type { Env } from '../../../_lib';
import { loadRegistryV4 } from '../../../_registry-v4';
import { searchRegistry } from '../../../_registry-v4-query';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const meta = { request_id: requestId(request) };
  try {
    const url = new URL(request.url);
    const { data } = await loadRegistryV4(env, request.url);
    const limit = Number.parseInt(url.searchParams.get('limit') || '50', 10);
    const items = searchRegistry(data, url.searchParams.get('q') || '', url.searchParams.get('type') || undefined, Number.isFinite(limit) ? limit : 50);
    return apiData({ items, count: items.length }, { ...meta, registry_revision: data.revision });
  } catch (error) {
    return apiError(error, meta, statusForError(error));
  }
};

export const onRequestOptions: PagesFunction = () => optionsResponse();
