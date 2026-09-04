import { apiData, apiError, optionsResponse, requestId } from '../../../_api-v2';
import type { Env } from '../../../_lib';
import { loadRegistryV4 } from '../../../_registry-v4';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const meta = { request_id: requestId(request) };
  try {
    const { data } = await loadRegistryV4(env, request.url);
    const packagesByPublisher = new Map<string, number>();
    for (const pkg of data.packages) packagesByPublisher.set(pkg.publisher_id, (packagesByPublisher.get(pkg.publisher_id) || 0) + 1);
    const items = (data.publishers || []).map((publisher: any) => ({
      ...publisher,
      package_count: packagesByPublisher.get(String(publisher.id)) || 0,
    })).sort((a: any, b: any) => b.package_count - a.package_count || String(a.id).localeCompare(String(b.id)));
    return apiData({ items, count: items.length }, { ...meta, registry_revision: data.revision });
  } catch (error) {
    return apiError(error, meta, 500);
  }
};

export const onRequestOptions: PagesFunction = () => optionsResponse();
