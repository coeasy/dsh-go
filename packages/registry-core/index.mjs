import { createHash } from 'node:crypto';
import {
  ERROR_CODES,
  ProtocolError,
  compareVersion,
  normalizePackageId,
  normalizePackageType,
  normalizeReleaseChannel,
  packageKey,
  parseVersion,
} from '../protocol-core/index.mjs';

export const REGISTRY_SCHEMA_VERSION = 4;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function sourceRecordType(record) {
  if (record?.type) return normalizePackageType(record.type);
  const runtimeType = String(record?.runtime?.type || '').toLowerCase();
  if (['plugin', 'mcp', 'skill', 'agent'].includes(runtimeType)) return normalizePackageType(runtimeType);
  const capabilities = Array.isArray(record?.capabilities) ? record.capabilities.map((value) => String(value).toLowerCase()) : [];
  for (const candidate of ['mcp', 'skill', 'agent']) if (capabilities.includes(candidate)) return candidate;
  return 'plugin';
}

function publisherId(record) {
  const declared = record?.publisher?.id || record?.publisher?.login || record?.publisher?.name;
  if (declared) return String(declared).trim().toLowerCase();
  const repo = String(record?.source?.repo || '');
  return (repo.split('/')[0] || 'unknown').toLowerCase();
}

function normalizeDependency(value, defaultType) {
  if (typeof value === 'string') {
    const coordinate = String(value).trim();
    const colon = coordinate.indexOf(':');
    const explicitType = colon > 0 ? coordinate.slice(0, colon) : defaultType;
    const body = colon > 0 ? coordinate.slice(colon + 1) : coordinate;
    const at = body.lastIndexOf('@');
    return {
      type: normalizePackageType(explicitType),
      id: normalizePackageId(at > 0 ? body.slice(0, at) : body),
      range: at > 0 ? body.slice(at + 1) || '*' : '*',
      optional: false,
    };
  }
  return {
    type: normalizePackageType(value?.type || defaultType),
    id: normalizePackageId(value?.id),
    range: String(value?.range || value?.version || '*').trim() || '*',
    optional: value?.optional === true,
  };
}

function normalizeRelease(record, type) {
  const version = String(record?.version || '').trim().replace(/^v/, '');
  parseVersion(version);
  const source = record?.source || {};
  const commit = String(source.commit || '').trim();
  if (!/^[0-9a-f]{40}$/i.test(commit)) {
    throw new ProtocolError(ERROR_CODES.ARTIFACT_DIGEST_MISMATCH, `registry release requires an immutable 40-character commit: ${type}:${record?.id}@${version}`);
  }
  const artifact = record?.artifact && typeof record.artifact === 'object' ? clone(record.artifact) : {};
  const integrity = String(artifact.integrity || artifact.sha256 || '').trim();
  return {
    version,
    channel: normalizeReleaseChannel(record?.channel || record?.release_channel || 'stable'),
    commit: commit.toLowerCase(),
    published_at: String(record?.published_at || record?.updated_at || record?.metadata?.updated_at || ''),
    dependencies: (Array.isArray(record?.dependencies) ? record.dependencies : []).map((dependency) => normalizeDependency(dependency, type)),
    compatibility: clone(record?.compatibility || {}),
    permissions: [...new Set((Array.isArray(record?.permissions) ? record.permissions : []).map(String))].sort(),
    artifact: {
      ...artifact,
      ...(integrity ? { integrity } : {}),
    },
    security: clone(record?.security || {}),
    entrypoints: clone(record?.entrypoints || record?.runtime?.entrypoints || {}),
    capabilities: [...new Set((Array.isArray(record?.capabilities) ? record.capabilities : []).map(String))].sort(),
    yanked: record?.security?.yanked === true || record?.yanked === true,
    revoked: record?.security?.revoked === true || record?.revoked === true,
  };
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]));
}

export function registryRevision(payload) {
  const canonical = JSON.stringify(stableObject({
    schema_version: payload.schema_version,
    packages: payload.packages,
    publishers: payload.publishers,
    advisories: payload.advisories,
  }));
  return createHash('sha256').update(canonical).digest('hex');
}

export function buildRegistryV4(records, options = {}) {
  const groups = new Map();
  const publishers = new Map();
  const advisoryMap = new Map();

  for (const record of records || []) {
    const type = sourceRecordType(record);
    const id = normalizePackageId(record?.id);
    const key = packageKey(type, id);
    const release = normalizeRelease(record, type);
    const publisher_id = publisherId(record);
    const existing = groups.get(key) || {
      type,
      id,
      publisher_id,
      source: {
        provider: String(record?.source?.provider || 'github'),
        repo: String(record?.source?.repo || '').toLowerCase(),
      },
      metadata: clone(record?.metadata || {}),
      releases: [],
    };
    if (existing.releases.some((candidate) => candidate.version === release.version && candidate.channel === release.channel)) {
      throw new ProtocolError(ERROR_CODES.TRANSACTION_CONFLICT, `duplicate registry release: ${key}@${release.version} [${release.channel}]`);
    }
    existing.releases.push(release);
    groups.set(key, existing);

    if (!publishers.has(publisher_id)) {
      publishers.set(publisher_id, {
        id: publisher_id,
        display_name: String(record?.publisher?.name || record?.publisher?.login || publisher_id),
        repository_ownership: String(record?.publisher?.repository_ownership || 'unverified'),
        verified: record?.publisher?.verified === true,
      });
    }

    const advisories = Array.isArray(record?.security?.advisories) ? record.security.advisories : [];
    for (const advisory of advisories) {
      const advisoryId = String(advisory?.id || advisory?.advisory_id || '').trim();
      if (!advisoryId) continue;
      advisoryMap.set(advisoryId, {
        id: advisoryId,
        package: { type, id },
        severity: String(advisory?.severity || 'unknown').toLowerCase(),
        affected: String(advisory?.affected || advisory?.range || '*'),
        fixed: advisory?.fixed || advisory?.fixed_version || null,
        url: advisory?.url || null,
        title: advisory?.title || advisory?.summary || null,
      });
    }
  }

  const packages = [...groups.values()]
    .map((item) => ({ ...item, releases: item.releases.sort((a, b) => compareVersion(b.version, a.version)) }))
    .sort((a, b) => packageKey(a.type, a.id).localeCompare(packageKey(b.type, b.id)));
  const registry = {
    schema_version: REGISTRY_SCHEMA_VERSION,
    generated_at: options.generated_at || new Date().toISOString(),
    revision: '',
    packages,
    publishers: [...publishers.values()].sort((a, b) => a.id.localeCompare(b.id)),
    advisories: [...advisoryMap.values()].sort((a, b) => a.id.localeCompare(b.id)),
    metadata: {
      source: options.source || 'dsh-go-sync',
      package_count: packages.length,
      release_count: packages.reduce((sum, item) => sum + item.releases.length, 0),
    },
  };
  registry.revision = registryRevision(registry);
  return validateRegistryV4(registry);
}

export function validateRegistryV4(registry) {
  if (!registry || registry.schema_version !== REGISTRY_SCHEMA_VERSION || !Array.isArray(registry.packages)) {
    throw new Error('invalid Registry V4 payload');
  }
  const seen = new Set();
  for (const item of registry.packages) {
    item.type = normalizePackageType(item.type);
    item.id = normalizePackageId(item.id);
    const key = packageKey(item.type, item.id);
    if (seen.has(key)) throw new Error(`duplicate Registry V4 package: ${key}`);
    seen.add(key);
    if (!Array.isArray(item.releases) || item.releases.length === 0) throw new Error(`Registry V4 package has no releases: ${key}`);
    const releaseKeys = new Set();
    for (const release of item.releases) {
      parseVersion(release.version);
      release.channel = normalizeReleaseChannel(release.channel);
      if (!/^[0-9a-f]{40}$/i.test(String(release.commit || ''))) throw new Error(`Registry V4 release has invalid commit: ${key}@${release.version}`);
      const releaseKey = `${release.channel}:${release.version}`;
      if (releaseKeys.has(releaseKey)) throw new Error(`duplicate Registry V4 release: ${key}@${release.version} [${release.channel}]`);
      releaseKeys.add(releaseKey);
    }
  }
  const expectedRevision = registryRevision(registry);
  if (registry.revision && registry.revision !== expectedRevision) throw new Error('Registry V4 revision does not match canonical content');
  registry.revision = expectedRevision;
  return registry;
}

export function registryPackageMap(registry) {
  validateRegistryV4(registry);
  return new Map(registry.packages.map((item) => [packageKey(item.type, item.id), item]));
}

export function getRegistryPackage(registry, type, id) {
  return registryPackageMap(registry).get(packageKey(type, id)) || null;
}
