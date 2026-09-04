import { createHash } from 'node:crypto';
import {
  ERROR_CODES,
  ProtocolError,
  compareVersion,
  normalizePackageId,
  normalizePackageType,
  normalizeReleaseChannel,
  normalizeVersionRange,
  packageKey,
  parseVersion,
} from '../protocol-core/index.mjs';

export const REGISTRY_SCHEMA_VERSION = 4;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function sourceRecordType(record) {
  if (!record?.type) throw new ProtocolError(ERROR_CODES.INVALID_PACKAGE_TYPE, 'Registry V4 source record requires explicit type');
  return normalizePackageType(record.type);
}

function publisherId(record) {
  const declared = String(record?.publisher?.id || '').trim().toLowerCase();
  if (!declared) throw new Error(`Registry V4 source record requires explicit publisher.id: ${record?.id || '<unknown>'}`);
  if (!/^[a-z0-9_.-]+$/.test(declared)) throw new Error(`Registry V4 publisher.id is invalid: ${declared}`);
  return declared;
}

function normalizeDependency(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Registry V4 dependencies must be canonical PackageRequest objects');
  for (const key of ['type', 'id', 'range', 'channel']) if (value[key] === undefined) throw new Error(`Registry V4 dependency.${key} is required`);
  return {
    type: normalizePackageType(value.type),
    id: normalizePackageId(value.id),
    range: normalizeVersionRange(value.range),
    channel: normalizeReleaseChannel(value.channel),
    optional: value.optional === true,
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
  const integrity = String(artifact.integrity || artifact.digest || artifact.sha256 || '').trim();
  return {
    version,
    channel: normalizeReleaseChannel(record?.channel),
    commit: commit.toLowerCase(),
    published_at: String(record?.published_at || record?.updated_at || record?.metadata?.updated_at || ''),
    dependencies: (Array.isArray(record?.dependencies) ? record.dependencies : []).map(normalizeDependency),
    compatibility: clone(record?.compatibility || {}),
    permissions: [...new Set((Array.isArray(record?.permissions) ? record.permissions : []).map(String))].sort(),
    artifact: {
      ...artifact,
      ...(integrity ? { integrity } : {}),
    },
    security: clone(record?.security || {}),
    entrypoints: clone(record?.entrypoints || {}),
    runtime: clone(record?.runtime || {}),
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
    const sourceRepo = String(record?.source?.repo || '').trim().toLowerCase();
    if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(sourceRepo)) throw new Error(`Registry V4 source.repo must be explicit owner/name: ${key}`);
    const existing = groups.get(key) || {
      type,
      id,
      publisher_id,
      source: {
        provider: String(record?.source?.provider || 'github').trim().toLowerCase(),
        repo: sourceRepo,
      },
      metadata: clone(record?.metadata || {}),
      releases: [],
    };
    if (existing.publisher_id !== publisher_id) throw new ProtocolError(ERROR_CODES.TRANSACTION_CONFLICT, `publisher identity changed across releases: ${key}`);
    if (existing.source.repo !== sourceRepo) throw new ProtocolError(ERROR_CODES.TRANSACTION_CONFLICT, `repository identity changed across releases: ${key}`);
    if (existing.releases.some((candidate) => candidate.version === release.version && candidate.channel === release.channel)) {
      throw new ProtocolError(ERROR_CODES.TRANSACTION_CONFLICT, `duplicate registry release: ${key}@${release.version} [${release.channel}]`);
    }
    existing.releases.push(release);
    groups.set(key, existing);

    if (!publishers.has(publisher_id)) {
      publishers.set(publisher_id, {
        id: publisher_id,
        display_name: String(record?.publisher?.name || publisher_id),
        repository_ownership: String(record?.publisher?.repository_ownership || 'unverified'),
        verified: record?.publisher?.verified === true,
        identity: record?.publisher?.identity || null,
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
        affected: normalizeVersionRange(advisory?.affected || advisory?.range || '*'),
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
  const publisherIds = new Set((Array.isArray(registry.publishers) ? registry.publishers : []).map((publisher) => String(publisher?.id || '').toLowerCase()).filter(Boolean));
  const seen = new Set();
  for (const item of registry.packages) {
    item.type = normalizePackageType(item.type);
    item.id = normalizePackageId(item.id);
    const key = packageKey(item.type, item.id);
    if (seen.has(key)) throw new Error(`duplicate Registry V4 package: ${key}`);
    seen.add(key);
    if (!item.publisher_id || !publisherIds.has(String(item.publisher_id).toLowerCase())) throw new Error(`Registry V4 package publisher is missing from publishers: ${key}`);
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(item.source?.repo || ''))) throw new Error(`Registry V4 package has invalid source.repo: ${key}`);
    if (!Array.isArray(item.releases) || item.releases.length === 0) throw new Error(`Registry V4 package has no releases: ${key}`);
    const releaseKeys = new Set();
    for (const release of item.releases) {
      parseVersion(release.version);
      release.channel = normalizeReleaseChannel(release.channel);
      if (!/^[0-9a-f]{40}$/i.test(String(release.commit || ''))) throw new Error(`Registry V4 release has invalid commit: ${key}@${release.version}`);
      for (const dependency of release.dependencies || []) normalizeDependency(dependency);
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
