import { ProtocolError, ERROR_CODES } from '../../../../../packages/protocol-core/index.mjs';
import { apiData, apiError, optionsResponse, requestId, statusForError } from '../../../../_api-v2';
import type { Env } from '../../../../_lib';
import { loadRegistryV4 } from '../../../../_registry-v4';
import { findRegistryPackage, publicPackage, sortedReleases } from '../../../../_registry-v4-query';

function param(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] || '' : value || ''; }

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const meta = { request_id: requestId(request) };
  try {
    const { data } = await loadRegistryV4(env, request.url);
    const pkg = findRegistryPackage(data, param(params.type), param(params.id));
    if (!pkg) throw new ProtocolError(ERROR_CODES.PACKAGE_NOT_FOUND, 'package not found');
    return apiData({ ...publicPackage(pkg), releases: sortedReleases(pkg) }, { ...meta, registry_revision: data.revision });
  } catch (error) {
    return apiError(error, meta, statusForError(error));
  }
};

export const onRequestOptions: PagesFunction = () => optionsResponse();
