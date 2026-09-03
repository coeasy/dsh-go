import { error, internalError, json, type Env } from '../../_lib';
import { loadRegistryV3 } from '../../_registry';
import { normalizeEdgePackageRequest, resolveEdgePackageRequest } from '../../_package-request';
import { loadLocalizationOverlay, packageDetailV2, requestedLocale } from '../../_marketplace-v4';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  let input;
  try {
    input = normalizeEdgePackageRequest({
      id: url.searchParams.get('id') || undefined,
      type: url.searchParams.get('type') || undefined,
      version: url.searchParams.get('version') || undefined,
      channel: url.searchParams.get('channel') || undefined,
    });
  } catch (cause) {
    return error(400, cause instanceof Error ? cause.message : 'invalid install request');
  }
  let data;
  try {
    ({ data } = await loadRegistryV3(env, request.url));
  } catch (cause) {
    return internalError(cause);
  }
  let selection;
  try {
    selection = resolveEdgePackageRequest(data.plugins, {
      id: input.id,
      type: input.type,
      version: input.versionRange,
      channel: input.channel,
    });
  } catch (cause) {
    const failure = cause as Error & { code?: string; security?: unknown };
    const status = failure.code?.startsWith('DSH_') ? 409 : 404;
    return json({
      error: { code: failure.code || 'DSH_PACKAGE_NOT_FOUND', message: failure.message },
      security: failure.security || null,
      executed: false,
      remote_mutation_supported: false,
    }, { status });
  }
  try {
    const locale = requestedLocale(request);
    const overlay = await loadLocalizationOverlay(env, request.url, locale);
    const detail = packageDetailV2(selection.package, overlay);
    return json({
      request: { id: input.id, type: input.type || detail.identity.type, version_range: selection.request.versionRange, channel: selection.request.channel },
      resolved: detail.identity,
      presentation: detail.presentation,
      trust: detail.trust,
      permissions: detail.permissions,
      dependencies: detail.dependencies,
      local_install: detail.local_install,
      blocked_candidates: selection.blocked,
      executed: false,
      remote_mutation_supported: false,
    });
  } catch (cause) {
    return internalError(cause);
  }
};

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, If-None-Match, Accept-Language',
    'Access-Control-Max-Age': '86400',
  },
});
