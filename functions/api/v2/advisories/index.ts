import { apiData, apiError, optionsResponse, requestId } from '../../../_api-v2';
import type { Env } from '../../../_lib';
import { loadRegistryV4 } from '../../../_registry-v4';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const meta = { request_id: requestId(request) };
  try {
    const url = new URL(request.url);
    const severity = (url.searchParams.get('severity') || '').trim().toLowerCase();
    const { data } = await loadRegistryV4(env, request.url);
    const items = (data.advisories || []).filter((item: any) => !severity || String(item.severity || '').toLowerCase() === severity);
    return apiData({ items, count: items.length }, { ...meta, registry_revision: data.revision });
  } catch (error) {
    return apiError(error, meta, 500);
  }
};

export const onRequestOptions: PagesFunction = () => optionsResponse();
