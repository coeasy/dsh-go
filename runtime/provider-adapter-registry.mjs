import { assertProviderAdapterRelease, providerAdapterChannel, sha256Hex, stableStringify } from './provider-adapter.mjs';
import { compareVersions, selectHighestVersion } from './semver.mjs';

export const PROVIDER_ADAPTER_REGISTRY_VERSION = 1;
export const PROVIDER_ADAPTER_REGISTRY_SCHEMA_VERSION = '1.0.0';
const CHANNELS = new Set(['stable', 'beta', 'nightly', 'dev']);

function groupContent(group) {
  return {
    id: group.id,
    name: group.name || group.id,
    description: group.description || '',
    kind: group.kind,
    channels: Object.fromEntries(Object.entries(group.channels || {}).sort(([a], [b]) => a.localeCompare(b))),
    versions: [...(group.versions || [])].sort((a, b) => compareVersions(a.version, b.version)),
  };
}

function contentHash(providers) {
  return sha256Hex(stableStringify({ providers: providers.map(groupContent) }));
}

function finalize(providers, at = new Date().toISOString()) {
  const sorted = [...providers].map(groupContent).sort((a, b) => a.id.localeCompare(b.id));
  return {
    registry_version: PROVIDER_ADAPTER_REGISTRY_VERSION,
    schema_version: PROVIDER_ADAPTER_REGISTRY_SCHEMA_VERSION,
    generated: {
      at,
      count: sorted.length,
      release_count: sorted.reduce((sum, group) => sum + group.versions.length, 0),
      content_hash: contentHash(sorted),
    },
    providers: sorted,
  };
}

export function createEmptyProviderAdapterRegistry() {
  return finalize([], null);
}

export function assertProviderAdapterRegistry(registry) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) throw new Error('provider adapter registry is required');
  if (Number(registry.registry_version) !== PROVIDER_ADAPTER_REGISTRY_VERSION) throw new Error(`provider adapter registry_version must be ${PROVIDER_ADAPTER_REGISTRY_VERSION}`);
  if (registry.schema_version !== PROVIDER_ADAPTER_REGISTRY_SCHEMA_VERSION) throw new Error(`provider adapter registry schema_version must be ${PROVIDER_ADAPTER_REGISTRY_SCHEMA_VERSION}`);
  if (!Array.isArray(registry.providers)) throw new Error('provider adapter registry providers must be an array');
  const seenIds = new Set();
  const providers = registry.providers.map((raw) => {
    if (!raw || typeof raw !== 'object' || !raw.id) throw new Error('provider adapter registry entry must have id');
    const id = String(raw.id);
    const idKey = id.toLowerCase();
    if (seenIds.has(idKey)) throw new Error(`duplicate provider adapter id: ${id}`);
    seenIds.add(idKey);
    const versions = (raw.versions || []).map(assertProviderAdapterRelease);
    const versionKeys = new Set();
    for (const release of versions) {
      if (release.id !== id) throw new Error(`provider adapter release id mismatch in registry: ${id}`);
      if (versionKeys.has(release.version)) throw new Error(`duplicate provider adapter version: ${id}@${release.version}`);
      versionKeys.add(release.version);
    }
    const channels = {};
    for (const [name, version] of Object.entries(raw.channels || {})) {
      if (!CHANNELS.has(name)) throw new Error(`unsupported provider adapter channel: ${name}`);
      if (!versionKeys.has(String(version))) throw new Error(`provider adapter channel ${id}:${name} points to missing version ${version}`);
      if (name === 'stable' && String(version).includes('-')) throw new Error(`provider adapter stable channel cannot point to prerelease: ${id}@${version}`);
      channels[name] = String(version);
    }
    const canonical = versions.at(-1) || null;
    return groupContent({
      id,
      name: raw.name || canonical?.name || id,
      description: raw.description || canonical?.description || '',
      kind: raw.kind || canonical?.kind || 'llm',
      channels,
      versions,
    });
  });
  const normalized = finalize(providers, registry.generated?.at ?? null);
  if (registry.generated?.content_hash && registry.generated.content_hash !== normalized.generated.content_hash) throw new Error('provider adapter registry content_hash mismatch');
  return normalized;
}

function findGroup(registry, id) {
  const key = String(id || '').toLowerCase();
  return registry.providers.find((item) => item.id.toLowerCase() === key) || null;
}

function channelForRelease(release, requested) {
  const channel = String(requested || providerAdapterChannel(release)).toLowerCase();
  if (!CHANNELS.has(channel)) throw new Error(`unsupported provider adapter channel: ${channel}`);
  if (channel === 'stable' && release.version.includes('-')) throw new Error('stable provider adapter channel cannot point to a prerelease');
  return channel;
}

export function registerProviderAdapter(registry, adapterRelease, options = {}) {
  const current = assertProviderAdapterRegistry(registry);
  const release = assertProviderAdapterRelease(adapterRelease);
  const channel = channelForRelease(release, options.channel);
  const providers = current.providers.map((item) => ({ ...item, channels: { ...item.channels }, versions: [...item.versions] }));
  let group = findGroup({ providers }, release.id);
  let changed = false;

  if (!group) {
    group = { id: release.id, name: release.name, description: release.description, kind: release.kind, channels: {}, versions: [] };
    providers.push(group);
    changed = true;
  } else if (group.kind !== release.kind) {
    throw new Error(`provider adapter kind is immutable for ${release.id}: ${group.kind} != ${release.kind}`);
  }

  const existing = group.versions.find((item) => item.version === release.version);
  if (existing) {
    if (existing.release_id !== release.release_id || existing.artifact.integrity !== release.artifact.integrity) {
      const error = new Error(`provider adapter release is immutable: ${release.id}@${release.version}`);
      error.code = 'DSH_PROVIDER_RELEASE_IMMUTABLE';
      throw error;
    }
  } else {
    group.versions.push(release);
    group.versions.sort((a, b) => compareVersions(a.version, b.version));
    group.name = release.name;
    group.description = release.description;
    changed = true;
  }

  const currentChannelVersion = group.channels[channel];
  const shouldMoveChannel = !currentChannelVersion
    || options.forceChannel === true
    || compareVersions(release.version, currentChannelVersion) >= 0;
  if (shouldMoveChannel && currentChannelVersion !== release.version) {
    group.channels[channel] = release.version;
    changed = true;
  }

  if (!changed) return { registry: current, changed: false, release, channel };
  return { registry: finalize(providers, options.at || new Date().toISOString()), changed: true, release, channel };
}

export function resolveProviderAdapter(registry, id, selector = 'stable') {
  const current = assertProviderAdapterRegistry(registry);
  const group = findGroup(current, id);
  if (!group) throw new Error(`provider adapter not found: ${id}`);
  const requested = String(selector || 'stable');
  const channelVersion = group.channels[requested];
  let version = channelVersion || group.versions.find((item) => item.version === requested)?.version || null;
  if (!version) version = selectHighestVersion(group.versions.map((item) => item.version), requested);
  if (!version) throw new Error(`provider adapter version not found: ${id}@${requested}`);
  const release = group.versions.find((item) => item.version === version);
  if (!release) throw new Error(`provider adapter release missing: ${id}@${version}`);
  return release;
}

export function rollbackProviderAdapterChannel(registry, id, channel = 'stable', toVersion = null, options = {}) {
  const current = assertProviderAdapterRegistry(registry);
  if (!CHANNELS.has(channel)) throw new Error(`unsupported provider adapter channel: ${channel}`);
  const providers = current.providers.map((item) => ({ ...item, channels: { ...item.channels }, versions: [...item.versions] }));
  const group = findGroup({ providers }, id);
  if (!group) throw new Error(`provider adapter not found: ${id}`);
  const active = group.channels[channel];
  if (!active) throw new Error(`provider adapter channel has no active release: ${id}:${channel}`);
  let target = toVersion;
  if (!target) {
    const candidates = group.versions
      .filter((release) => channel !== 'stable' || !release.version.includes('-'))
      .map((release) => release.version)
      .filter((version) => compareVersions(version, active) < 0)
      .sort(compareVersions);
    target = candidates.at(-1) || null;
  }
  if (!target || !group.versions.some((release) => release.version === target)) throw new Error(`provider adapter rollback target not found: ${id}@${target || '<previous>'}`);
  if (channel === 'stable' && target.includes('-')) throw new Error('stable provider adapter channel cannot point to a prerelease');
  if (target === active) return { registry: current, changed: false, from: active, to: target, channel };
  group.channels[channel] = target;
  return { registry: finalize(providers, options.at || new Date().toISOString()), changed: true, from: active, to: target, channel };
}

export function searchProviderAdapters(registry, query = '') {
  const current = assertProviderAdapterRegistry(registry);
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return current.providers;
  return current.providers.filter((group) => {
    const release = group.versions.at(-1);
    return [group.id, group.name, group.description, group.kind, ...(release?.capabilities || [])]
      .some((value) => String(value || '').toLowerCase().includes(needle));
  });
}
