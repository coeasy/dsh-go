import { ERROR_CODES, ProtocolError } from '../../../../packages/protocol-core/index.mjs';
import { apiData, apiError, optionsResponse, requestId, statusForError } from '../../../_api-v2';
import type { Env } from '../../../_lib';
import { loadRegistryV4 } from '../../../_registry-v4';
import { publicPackage } from '../../../_registry-v4-query';

function param(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] || '' : value || ''; }

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const meta = { request_id: requestId(request) };
  try {
    const { data } = await loadRegistryV4(env, request.url);
    const id = param(params.id).trim().toLowerCase();
    const publisher = (data.publishers || []).find((item: any) => String(item.id || '').toLowerCase() === id);
    if (!publisher) throw new ProtocolError(ERROR_CODES.PACKAGE_NOT_FOUND, `publisher not found: ${id}`);
    const packages = data.packages.filter((pkg) => pkg.publisher_id === id).map(publicPackage);
    return apiData({ publisher, packages }, { ...meta, registry_revision: data.revision });
  } catch (error) {
    return apiError(error, meta, statusForError(error));
  }
};

export const onRequestOptions: PagesFunction = () => optionsResponse();
