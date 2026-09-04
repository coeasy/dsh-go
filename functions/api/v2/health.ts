import { apiData, apiError, optionsResponse, requestId } from '../../_api-v2';
import type { Env } from '../../_lib';
import { loadRegistryV4 } from '../../_registry-v4';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const meta = { request_id: requestId(request) };
  try {
    const { data } = await loadRegistryV4(env, request.url);
    return apiData({
      status: 'ok',
      protocol_version: 2,
      registry_schema: 4,
      registry_revision: data.revision,
      package_count: data.packages.length,
      release_count: Number(data.metadata?.release_count || 0),
      generated_at: data.generated_at,
    }, { ...meta, registry_revision: data.revision });
  } catch (error) {
    return apiError(error, meta, 503);
  }
};

export const onRequestOptions: PagesFunction = () => optionsResponse();
