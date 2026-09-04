import { formatPackageCoordinate, normalizePackageRequest } from '../../../packages/protocol-core/index.mjs';
import { resolvePackage } from '../../../packages/resolver/index.mjs';
import { apiData, apiError, optionsResponse, parseJsonBody, requestId, statusForError } from '../../_api-v2';
import type { Env } from '../../_lib';
import { loadRegistryV4 } from '../../_registry-v4';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const meta = { request_id: requestId(request) };
  try {
    const body = await parseJsonBody(request);
    const packageRequest = normalizePackageRequest(body?.request || body);
    const { data } = await loadRegistryV4(env, request.url);
    const resolution = resolvePackage(data, packageRequest, body?.environment || {});
    const coordinate = formatPackageCoordinate(packageRequest);
    const params = new URLSearchParams({ spec: coordinate, channel: packageRequest.channel });
    return apiData({
      request: packageRequest,
      coordinate,
      resolution,
      local: {
        cli: `dsh package install ${coordinate}`,
        deep_link: `dsh://package/install?${params.toString()}`,
        executes_remotely: false,
        requires_local_confirmation: true,
      },
    }, { ...meta, registry_revision: data.revision }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error, meta, statusForError(error));
  }
};

export const onRequestOptions: PagesFunction = () => optionsResponse();
