import { error, internalError, isNotModified, json, notModifiedResponse, type Env } from '../../../../../../_lib';
import { ECOSYSTEM_TYPES, ecosystemType, loadRegistryV3, toEcosystemItem, type EcosystemType, type RegistryV3Plugin } from '../../../../../../_registry';

const ID_PATTERN = /^[A-Za-z0-9_.-]{1,200}$/;
const CHANNELS = new Set(['stable', 'beta', 'nightly', 'dev']);

function versionParts(value: string) {
  const normalized = value.trim().replace(/^v/i, '');
  const [core, pre = ''] = normalized.split('-', 2);
  const numbers = core.split('.').map((part) => Number.parseInt(part, 10));
  return {
    numbers: [numbers[0] || 0, numbers[1] || 0, numbers[2] || 0],
    pre: pre ? pre.split('.') : [],
  };
}

export function compareVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] - b.numbers[index];
  }
  if (!a.pre.length && b.pre.length) return 1;
  if (a.pre.length && !b.pre.length) return -1;
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index += 1) {
    const leftPart = a.pre[index];
    const rightPart = b.pre[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const leftNumber = /^\d+$/.test(leftPart);
    const rightNumber = /^\d+$/.test(rightPart);
    if (leftNumber && rightNumber && Number(leftPart) !== Number(rightPart)) return Number(leftPart) - Number(rightPart);
    if (leftNumber !== rightNumber) return leftNumber ? -1 : 1;
    if (leftPart !== rightPart) return leftPart.localeCompare(rightPart);
  }
  return 0;
}

export function sortRegistryVersions(records: RegistryV3Plugin[]): RegistryV3Plugin[] {
  return [...records].sort((left, right) => compareVersions(String(right.version), String(left.version))
    || String(right.source.commit).localeCompare(String(left.source.commit)));
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const type = String(params.type || '').toLowerCase();
    const id = String(params.id || '').trim();
    if (!ECOSYSTEM_TYPES.includes(type as EcosystemType) || !ID_PATTERN.test(id) || id === '.' || id === '..' || id.includes('..')) {
      return error(400, 'invalid package identity');
    }
    const normalizedId = id.toLowerCase();
    const url = new URL(request.url);
    const rawChannel = (url.searchParams.get('channel') || '').toLowerCase();
    if (rawChannel && !CHANNELS.has(rawChannel)) return error(400, 'unsupported package channel');

    const { data, etag } = await loadRegistryV3(env, request.url);
    const records = sortRegistryVersions(data.plugins.filter((record) =>
      record.id.toLowerCase() === normalizedId
      && ecosystemType(record) === type
      && (!rawChannel || (record.channel || record.release_channel || 'stable') === rawChannel),
    ));
    if (!records.length) return error(404, 'package not found: ' + type + ':' + normalizedId);

    const scopedEtag = etag + ':' + type + ':' + normalizedId + ':' + (rawChannel || '*');
    if (isNotModified(request, scopedEtag)) return notModifiedResponse(scopedEtag);

    return json({
      format: 'dsh-registry-package-versions',
      distribution_version: 1,
      registry_version: data.registry_version,
      key: type + ':' + normalizedId,
      type,
      id: records[0].id,
      count: records.length,
      latest: toEcosystemItem(records[0]),
      versions: records.map((record) => ({
        version: record.version,
        channel: record.channel || record.release_channel || 'stable',
        source: record.source,
        artifact: record.artifact,
        runtime: record.runtime,
        capabilities: record.capabilities || [],
        permissions: record.permissions || [],
        dependencies: record.dependencies || [],
        publisher: record.publisher || null,
        security: record.security || null,
        metadata: record.metadata || {},
      })),
      meta: {
        api_version: 'v1',
        generated_at: data.generated?.at || null,
        registry_etag: etag,
        etag: scopedEtag,
      },
    }, { headers: { 'Cache-Control': 'public, max-age=120, s-maxage=600, stale-while-revalidate=86400' } }, scopedEtag);
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
