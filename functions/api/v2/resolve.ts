import { resolvePackage } from '../../../packages/resolver/index.mjs';
import { apiData, apiError, optionsResponse, parseJsonBody, requestId, statusForError } from '../../_api-v2';
import type { Env } from '../../_lib';
import { loadRegistryV4 } from '../../_registry-v4';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const meta = { request_id: requestId(request) };
  try {
    const body = await parseJsonBody(request);
    const { data } = await loadRegistryV4(env, request.url);
    const plan = resolvePackage(data, body?.request || body, body?.environment || {});
    return apiData(plan, { ...meta, registry_revision: data.revision }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error, meta, statusForError(error));
  }
};

export const onRequestOptions: PagesFunction = () => optionsResponse();
