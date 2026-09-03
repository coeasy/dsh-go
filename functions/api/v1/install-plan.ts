import { error, json, type Env } from '../../_lib';
import { loadRegistryV3 } from '../../_registry';
import { resolveEdgePackageRequest } from '../../_package-request';
import { loadLocalizationOverlay, packageDetailV2, requestedLocale } from '../../_marketplace-v4';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const type = url.searchParams.get('type') || undefined;
  const version = url.searchParams.get('version') || undefined;
  const channel = url.searchParams.get('channel') || undefined;
  if (!id) return error(400, 'id is required');
  const { data } = await loadRegistryV3(env, request.url);
  let selection;
  try {
    selection = resolveEdgePackageRequest(data.plugins, { id, type, version, channel });
  } catch (cause) {
    const failure = cause as Error & { code?: string; security?: unknown };
    const status = failure.code?.startsWith('DSH_') ? 409 : 404;
    return json({ error: failure.message, code: failure.code || 'DSH_PACKAGE_NOT_FOUND', security: failure.security || null, executed: false, remote_mutation_supported: false }, { status });
  }
  const locale = requestedLocale(request);
  const overlay = await loadLocalizationOverlay(env, request.url, locale);
  const detail = packageDetailV2(selection.package, overlay);
  return json({
    request: { id, type: type || detail.identity.type, version_range: selection.request.versionRange, channel: selection.request.channel },
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
};
