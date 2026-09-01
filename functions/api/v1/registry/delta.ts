import { error, internalError, isNotModified, json, notModifiedResponse, type Env } from '../../../_lib';

const DELTA_PATH = '/catalog/distribution-v1/delta.json';

function isDeltaPayload(value: unknown): value is {
  format: string;
  distribution_version: number;
  registry_version: number;
  from_content_hash: string | null;
  to_content_hash: string;
  content_hash: string;
  changed: Array<{ key: string; content_hash: string }>;
  removed: string[];
  counts: Record<string, number>;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return payload.format === 'dsh-registry-distribution'
    && payload.distribution_version === 1
    && payload.registry_version === 3
    && (payload.from_content_hash === null || typeof payload.from_content_hash === 'string')
    && typeof payload.to_content_hash === 'string'
    && typeof payload.content_hash === 'string'
    && Array.isArray(payload.changed)
    && Array.isArray(payload.removed)
    && Boolean(payload.counts && typeof payload.counts === 'object');
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const asset = await env.ASSETS.fetch(new URL(DELTA_PATH, request.url));
    if (asset.status === 404) return error(404, 'registry delta unavailable');
    if (!asset.ok) throw new Error('registry delta load failed: ' + asset.status);
    const payload = await asset.json() as unknown;
    if (!isDeltaPayload(payload)) throw new Error('registry delta contract invalid');
    if (isNotModified(request, payload.content_hash)) return notModifiedResponse(payload.content_hash);

    return json(payload, {
      headers: {
        'Cache-Control': 'public, max-age=120, s-maxage=600, stale-while-revalidate=86400',
      },
    }, payload.content_hash);
  } catch (cause) {
    return internalError(cause);
  }
};

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
    'Access-Control-Max-Age': '86400',
  },
});
