import { apiData, apiError, optionsResponse, requestId } from '../../../_api-v2';
import type { Env } from '../../../_lib';
import { loadRegistryV4 } from '../../../_registry-v4';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const meta = { request_id: requestId(request) };
  try {
    const { data } = await loadRegistryV4(env, request.url);
    return apiData({
      schema_version: 4,
      revision: data.revision,
      generated_at: data.generated_at,
      distribution: '/catalog/registry-v4/index.json',
    }, { ...meta, registry_revision: data.revision });
  } catch (error) {
    return apiError(error, meta, 503);
  }
};

export const onRequestOptions: PagesFunction = () => optionsResponse();
