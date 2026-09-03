import { createHash } from 'node:crypto';

export const PROVIDER_ADAPTER_VERSION = '1.0.0';
export const PROVIDER_ADAPTER_RELEASE_FORMAT = 1;
export const PROVIDER_ADAPTER_KINDS = Object.freeze(['llm', 'mcp', 'skill', 'agent-runtime']);
export const PROVIDER_ADAPTER_CHANNELS = Object.freeze(['stable', 'beta', 'nightly', 'dev']);

const ID_RE = /^[A-Za-z0-9_.-]+$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA256_RE = /^sha256-[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/i;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const FORBIDDEN_IDS = new Set(['__proto__', 'prototype', 'constructor']);

export function assertProviderAdapterId(value) {
  const id = String(value || '').trim();
  if (!ID_RE.test(id) || FORBIDDEN_IDS.has(id.toLowerCase())) throw new Error('invalid provider adapter id');
  return id;
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeAdapterPath(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.includes('\\') || raw.startsWith('/') || raw.includes('\0')) throw new Error(`unsafe provider adapter path: ${raw || '<empty>'}`);
  const parts = raw.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error(`unsafe provider adapter path: ${raw}`);
  if (raw.length > 255) throw new Error(`provider adapter path is too long: ${raw}`);
  return parts.join('/');
}

function normalizeStringArray(value, max = 256) {
  const values = Array.isArray(value) ? value : [];
  return [...new Set(values.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))].sort().slice(0, max);
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function providerAdapterChannel(adapter) {
  const explicit = String(adapter?.release?.channel || '').trim().toLowerCase();
  const channel = explicit || (String(adapter?.version || '').includes('-') ? 'beta' : 'stable');
  if (!PROVIDER_ADAPTER_CHANNELS.includes(channel)) throw new Error(`unsupported provider adapter channel: ${channel}`);
  if (channel === 'stable' && String(adapter?.version || '').includes('-')) throw new Error('stable provider adapter releases cannot use prerelease versions');
  return channel;
}

export function normalizeProviderAdapter(adapter) {
  const entrypoint = normalizeAdapterPath(adapter.entrypoint);
  const files = [...new Set([entrypoint, ...normalizeStringArray(adapter.files).map(normalizeAdapterPath)])].sort();
  return {
    manifest_version: String(adapter.manifest_version || PROVIDER_ADAPTER_VERSION).trim(),
    type: 'provider-adapter',
    id: String(adapter.id || '').trim(),
    name: String(adapter.name || adapter.id || '').trim().slice(0, 200),
    description: String(adapter.description || '').trim().slice(0, 4000),
    version: String(adapter.version || '').trim().replace(/^v/, ''),
    kind: String(adapter.kind || '').trim().toLowerCase(),
    entrypoint,
    files,
    capabilities: normalizeStringArray(adapter.capabilities),
    compatibility: normalizeObject(adapter.compatibility),
    publisher: adapter.publisher && typeof adapter.publisher === 'object' && !Array.isArray(adapter.publisher) ? adapter.publisher : null,
    security: adapter.security && typeof adapter.security === 'object' && !Array.isArray(adapter.security) ? adapter.security : null,
    release: { ...normalizeObject(adapter.release), channel: providerAdapterChannel(adapter) },
  };
}

export function assertProviderAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter)) throw new Error('provider adapter manifest is required');
  if (!Array.isArray(adapter.files) || adapter.files.length === 0) throw new Error('provider adapter files must be an explicit non-empty array');
  const normalized = normalizeProviderAdapter(adapter);
  if (normalized.manifest_version !== PROVIDER_ADAPTER_VERSION) throw new Error(`provider adapter manifest_version must be ${PROVIDER_ADAPTER_VERSION}`);
  assertProviderAdapterId(normalized.id);
  if (!normalized.name) throw new Error('provider adapter name is required');
  if (!VERSION_RE.test(normalized.version)) throw new Error('invalid provider adapter version');
  if (!PROVIDER_ADAPTER_KINDS.includes(normalized.kind)) throw new Error('unsupported provider adapter kind');
  if (!normalized.files.includes(normalized.entrypoint)) throw new Error('provider adapter files must include entrypoint');
  if (normalized.files.length > 256) throw new Error('provider adapter file list exceeds 256 entries');
  return normalized;
}

export function providerAdapterKey(adapter) {
  const normalized = assertProviderAdapter(adapter);
  return `${normalized.id}@${normalized.version}`;
}

export function providerAdapterDigest(adapter) {
  return sha256Hex(stableStringify(assertProviderAdapter(adapter)));
}

function normalizeArtifact(artifact) {
  const integrity = String(artifact?.integrity || '').trim().toLowerCase();
  const size = Number(artifact?.size || 0);
  const fileName = String(artifact?.file_name || '').trim();
  const url = String(artifact?.url || '').trim();
  if (!SHA256_RE.test(integrity)) throw new Error('provider adapter artifact integrity must be sha256-<hex>');
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error('provider adapter artifact size must be a positive integer');
  if (!fileName || fileName.includes('/') || fileName.includes('\\')) throw new Error('provider adapter artifact file_name must be a basename');
  if (url) {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.hash) throw new Error('provider adapter artifact URL must not contain credentials or fragments');
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname))) {
      throw new Error('provider adapter artifact URL must use HTTPS');
    }
  }
  return { kind: 'tar+gzip', algorithm: 'sha256', integrity, size, file_name: fileName, ...(url ? { url } : {}) };
}

function normalizeSource(source) {
  if (!source || typeof source !== 'object') return null;
  const repository = String(source.repository || '').trim();
  const commit = String(source.commit || '').trim().toLowerCase();
  const tag = String(source.tag || '').trim();
  if (!repository && !commit && !tag) return null;
  if (!REPO_RE.test(repository)) throw new Error('provider adapter source.repository must be owner/repo');
  if (!COMMIT_RE.test(commit)) throw new Error('provider adapter source.commit must be a 40-character SHA');
  return { provider: 'github', repository, commit, ...(tag ? { tag } : {}) };
}

export function releaseIdentityPayload(adapter, artifact, source = null) {
  const normalized = assertProviderAdapter(adapter);
  return {
    release_format: PROVIDER_ADAPTER_RELEASE_FORMAT,
    adapter: normalized,
    manifest_hash: providerAdapterDigest(normalized),
    artifact: normalizeArtifact(artifact),
    source: normalizeSource(source),
  };
}

export function createProviderAdapterRelease(adapter, artifact, source = null) {
  const identity = releaseIdentityPayload(adapter, artifact, source);
  return {
    release_format: PROVIDER_ADAPTER_RELEASE_FORMAT,
    ...identity.adapter,
    manifest_hash: identity.manifest_hash,
    content_hash: identity.manifest_hash,
    artifact: identity.artifact,
    source: identity.source,
    release_id: sha256Hex(stableStringify(identity)),
  };
}

export function assertProviderAdapterRelease(release) {
  if (!release || typeof release !== 'object' || Array.isArray(release)) throw new Error('provider adapter release is required');
  if (Number(release.release_format) !== PROVIDER_ADAPTER_RELEASE_FORMAT) throw new Error(`provider adapter release_format must be ${PROVIDER_ADAPTER_RELEASE_FORMAT}`);
  const canonical = createProviderAdapterRelease(release, release.artifact, release.source);
  if (release.manifest_hash && release.manifest_hash !== canonical.manifest_hash) throw new Error('provider adapter manifest_hash mismatch');
  if (release.content_hash && release.content_hash !== canonical.content_hash) throw new Error('provider adapter content_hash mismatch');
  if (release.release_id !== canonical.release_id) throw new Error('provider adapter release_id mismatch');
  return canonical;
}
