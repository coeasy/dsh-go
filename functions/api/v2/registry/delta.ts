import { apiData, apiError, optionsResponse, requestId } from '../../../_api-v2';
import type { Env } from '../../../_lib';
import { loadRegistryV4 } from '../../../_registry-v4';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const meta = { request_id: requestId(request) };
  try {
    const url = new URL(request.url);
    const from = (url.searchParams.get('from') || '').trim();
    const { data } = await loadRegistryV4(env, request.url);
    if (!from || from === data.revision) {
      return apiData({ from: from || data.revision, to: data.revision, changed: false, available: true, operations: [] }, { ...meta, registry_revision: data.revision });
    }
    const deltaPath = `/catalog/registry-v4/delta/${encodeURIComponent(from)}-${encodeURIComponent(data.revision)}.json`;
    const response = await env.ASSETS.fetch(new URL(deltaPath, request.url));
    if (response.ok) {
      return apiData(await response.json(), { ...meta, registry_revision: data.revision });
    }
    return apiData({
      from,
      to: data.revision,
      changed: true,
      available: false,
      full_refresh_required: true,
      distribution: '/catalog/registry-v4/index.json',
    }, { ...meta, registry_revision: data.revision });
  } catch (error) {
    return apiError(error, meta, 503);
  }
};

export const onRequestOptions: PagesFunction = () => optionsResponse();
