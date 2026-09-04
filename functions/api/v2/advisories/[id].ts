import { ERROR_CODES, ProtocolError } from '../../../../packages/protocol-core/index.mjs';
import { apiData, apiError, optionsResponse, requestId, statusForError } from '../../../_api-v2';
import type { Env } from '../../../_lib';
import { loadRegistryV4 } from '../../../_registry-v4';

function param(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] || '' : value || ''; }

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const meta = { request_id: requestId(request) };
  try {
    const { data } = await loadRegistryV4(env, request.url);
    const id = param(params.id).trim();
    const advisory = (data.advisories || []).find((item: any) => String(item.id || '') === id);
    if (!advisory) throw new ProtocolError(ERROR_CODES.PACKAGE_NOT_FOUND, `advisory not found: ${id}`);
    return apiData(advisory, { ...meta, registry_revision: data.revision });
  } catch (error) {
    return apiError(error, meta, statusForError(error));
  }
};

export const onRequestOptions: PagesFunction = () => optionsResponse();
