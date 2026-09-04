import {
  normalizePackageId,
  normalizePackageRequest,
  normalizePackageType,
  normalizeReleaseChannel,
  parseVersion,
} from './index.mjs';

export const PACKAGE_MANIFEST_VERSION = 2;
export const PACKAGE_MANIFEST_FILE = 'dsh-package.json';
export const PACKAGE_RELEASE_DESCRIPTOR_VERSION = 2;

function objectField(input, key, required = true) {
  const value = input?.[key];
  if (value === undefined && !required) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`package manifest ${key} must be an object`);
  return { ...value };
}

function stringArray(value, key, required = true) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value)) throw new Error(`package manifest ${key} must be an array`);
  return [...new Set(value.map((item) => {
    if (typeof item !== 'string' || !item.trim()) throw new Error(`package manifest ${key} entries must be non-empty strings`);
    return item.trim();
  }))].sort();
}

function normalizeDependency(dependency) {
  if (!dependency || typeof dependency !== 'object' || Array.isArray(dependency)) throw new Error('manifest dependency must be a canonical PackageRequest object');
  for (const key of ['type', 'id', 'range', 'channel']) {
    if (dependency[key] === undefined) throw new Error(`manifest dependency.${key} is required`);
  }
  const request = normalizePackageRequest({
    type: dependency.type,
    id: dependency.id,
    range: dependency.range,
    channel: dependency.channel,
    registry: dependency.registry,
  });
  return { ...request, optional: dependency.optional === true };
}

function normalizePublisher(value) {
  const publisher = objectField({ publisher: value }, 'publisher');
  const id = String(publisher.id || '').trim().toLowerCase();
  if (!id || id.length > 128 || !/^[a-z0-9_.-]+$/.test(id)) throw new Error('package manifest publisher.id must be a stable publisher identifier');
  return { ...publisher, id };
}

function normalizeSource(value) {
  if (value === undefined) return null;
  const source = objectField({ source: value }, 'source');
  const provider = String(source.provider || '').trim().toLowerCase();
  const repo = String(source.repo || '').trim();
  if (!provider) throw new Error('package manifest source.provider is required when source is declared');
  if (provider === 'github' && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('package manifest GitHub source.repo must be owner/name');
  return { ...source, provider, ...(repo ? { repo } : {}) };
}

function normalizeRuntime(value, type) {
  const runtime = objectField({ runtime: value }, 'runtime');
  if (runtime.type === undefined) throw new Error('package manifest runtime.type is required');
  if (normalizePackageType(runtime.type) !== type) throw new Error(`package manifest runtime.type must match package type ${type}`);
  return { ...runtime, type };
}

function releaseDescriptorError(message) {
  const error = new Error(message);
  error.code = 'DSH_RELEASE_DESCRIPTOR_INVALID';
  return error;
}

function normalizePackagePath(value) {
  if (value === undefined || value === null || value === '' || value === '.') return null;
  const path = String(value).trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!path || path.startsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw releaseDescriptorError('release descriptor package_path must be a safe repository-relative directory');
  }
  return path;
}

function normalizeReleaseArtifact(value, repository, tag, packagePath) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw releaseDescriptorError('release descriptor artifact must be an object');
  const kind = String(value.kind || '').trim();
  const url = String(value.url || '').trim();
  const digest = String(value.digest || value.integrity || '').trim().toLowerCase();
  const format = String(value.format || '').trim().toLowerCase();
  const stripComponents = Number(value.strip_components);
  if (kind !== 'release-archive') throw releaseDescriptorError('release descriptor artifact.kind must be release-archive');
  if (!/^sha256-[0-9a-f]{64}$/.test(digest)) throw releaseDescriptorError('release descriptor artifact.digest must be sha256-<64 hex>');
  if (format !== 'tgz') throw releaseDescriptorError('release descriptor artifact.format must be tgz');
  const expectedStrip = packagePath ? packagePath.split('/').length + 1 : 1;
  if (!Number.isInteger(stripComponents) || stripComponents !== expectedStrip) {
    throw releaseDescriptorError(`release descriptor artifact.strip_components must be ${expectedStrip}`);
  }
  let parsed;
  try { parsed = new URL(url); }
  catch { throw releaseDescriptorError('release descriptor artifact.url must be a valid URL'); }
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com') {
    throw releaseDescriptorError('release descriptor artifact.url must use https://github.com');
  }
  const expectedPrefix = `/${repository}/releases/download/${encodeURIComponent(tag)}/`;
  if (!parsed.pathname.toLowerCase().startsWith(expectedPrefix.toLowerCase())) {
    throw releaseDescriptorError('release descriptor artifact.url must belong to the declared repository and canonical release tag');
  }
  return { ...value, kind, url, digest, format, strip_components: stripComponents };
}

export function safePackageReleaseName(value) {
  return String(value || '').trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * @param {{ id?: string, version?: string, package_path?: string | null }} input
 */
export function packageReleaseTag(input = {}) {
  const { id, version, package_path: packagePath = null } = input;
  const normalizedId = normalizePackageId(id);
  const normalizedVersion = String(version || '').trim().replace(/^v/, '');
  parseVersion(normalizedVersion);
  if (!packagePath) return `v${normalizedVersion}`;
  const safeId = safePackageReleaseName(normalizedId);
  if (!safeId) throw new Error('package id cannot produce a release-safe tag');
  return `${safeId}-v${normalizedVersion}`;
}

export function validatePackageManifest(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('package manifest must be an object');
  if ('schema_version' in input) throw new Error('legacy package manifest schema_version is not supported; use manifest_version: 2');
  if (input.manifest_version !== PACKAGE_MANIFEST_VERSION) throw new Error(`unsupported package manifest_version: ${String(input.manifest_version)}`);
  for (const key of ['type', 'id', 'version', 'channel', 'name', 'description', 'runtime', 'entrypoints', 'permissions', 'dependencies', 'compatibility', 'publisher', 'security', 'metadata']) {
    if (input[key] === undefined) throw new Error(`package manifest ${key} is required`);
  }

  const type = normalizePackageType(input.type);
  const id = normalizePackageId(input.id);
  const version = String(input.version || '').trim().replace(/^v/, '');
  parseVersion(version);
  const channel = normalizeReleaseChannel(input.channel);
  if (options.type && type !== normalizePackageType(options.type)) throw new Error(`package manifest type mismatch: expected ${options.type}, got ${type}`);
  if (options.id && id !== normalizePackageId(options.id)) throw new Error(`package manifest id mismatch: expected ${options.id}, got ${id}`);
  if (options.version && version !== String(options.version).replace(/^v/, '')) throw new Error(`package manifest version mismatch: expected ${options.version}, got ${version}`);

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 200) throw new Error('package manifest name must be 1-200 characters');
  if (typeof input.description !== 'string' || input.description.length > 4000) throw new Error('package manifest description must be a string of at most 4000 characters');

  const runtime = normalizeRuntime(input.runtime, type);
  const entrypoints = objectField(input, 'entrypoints');
  const capabilities = stringArray(input.capabilities, 'capabilities', false);
  const permissions = stringArray(input.permissions, 'permissions');
  if (!Array.isArray(input.dependencies)) throw new Error('package manifest dependencies must be an array');
  const dependencies = input.dependencies.map(normalizeDependency);
  const compatibility = objectField(input, 'compatibility');
  const publisher = normalizePublisher(input.publisher);
  const security = objectField(input, 'security');
  const metadata = objectField(input, 'metadata');
  const source = normalizeSource(input.source);
  const release = input.release === undefined ? null : objectField(input, 'release');
  const permissionPolicy = input.permission_policy === undefined ? null : objectField(input, 'permission_policy');
  const localization = input.localization === undefined ? null : objectField(input, 'localization');
  const conflicts = stringArray(input.conflicts, 'conflicts', false);
  const replaces = stringArray(input.replaces, 'replaces', false);
  const provides = stringArray(input.provides, 'provides', false);
  const typeConfig = input[type] === undefined ? null : objectField(input, type);

  return {
    manifest_version: PACKAGE_MANIFEST_VERSION,
    type,
    id,
    version,
    channel,
    name,
    description: input.description,
    runtime,
    entrypoints,
    capabilities,
    permissions,
    dependencies,
    compatibility,
    publisher,
    security,
    metadata,
    ...(source ? { source } : {}),
    ...(release ? { release } : {}),
    ...(permissionPolicy ? { permission_policy: permissionPolicy } : {}),
    ...(localization ? { localization } : {}),
    ...(conflicts.length ? { conflicts } : {}),
    ...(replaces.length ? { replaces } : {}),
    ...(provides.length ? { provides } : {}),
    ...(typeConfig ? { [type]: typeConfig } : {}),
  };
}

export function validatePackageReleaseDescriptor(input, options = {}) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw releaseDescriptorError('release descriptor must be an object');
    if (input.release_version !== PACKAGE_RELEASE_DESCRIPTOR_VERSION
      || input.protocol_version !== 2
      || input.manifest_version !== PACKAGE_MANIFEST_VERSION) {
      throw releaseDescriptorError(`release descriptor must use release_version=${PACKAGE_RELEASE_DESCRIPTOR_VERSION}, protocol_version=2 and manifest_version=${PACKAGE_MANIFEST_VERSION}`);
    }
    const type = normalizePackageType(input.type);
    const id = normalizePackageId(input.id);
    const version = String(input.version || '').trim().replace(/^v/, '');
    parseVersion(version);
    const channel = normalizeReleaseChannel(input.channel);
    const repository = String(input.repository || '').trim();
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw releaseDescriptorError('release descriptor repository must be owner/name');
    const commit = String(input.commit || '').trim().toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(commit)) throw releaseDescriptorError('release descriptor commit must be an immutable 40-character SHA');
    const packagePath = normalizePackagePath(input.package_path);
    const tag = String(input.tag || '').trim();
    const canonicalTag = packageReleaseTag({ id, version, package_path: packagePath });
    if (tag !== canonicalTag) throw releaseDescriptorError(`release descriptor tag must be canonical: ${canonicalTag}`);
    const manifest = validatePackageManifest(input.manifest, { type, id, version });
    if (manifest.channel !== channel) throw releaseDescriptorError('release descriptor channel must match Manifest V2');
    if (manifest.source?.provider === 'github' && manifest.source?.repo
      && String(manifest.source.repo).toLowerCase() !== repository.toLowerCase()) {
      throw releaseDescriptorError('release descriptor repository must match Manifest V2 source.repo');
    }
    const manifestFile = String(input.manifest_file || '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
    const expectedManifestFile = packagePath ? `${packagePath}/${PACKAGE_MANIFEST_FILE}` : PACKAGE_MANIFEST_FILE;
    if (manifestFile !== expectedManifestFile) throw releaseDescriptorError(`release descriptor manifest_file must be ${expectedManifestFile}`);
    const publishedAt = String(input.published_at || '').trim();
    if (!publishedAt || Number.isNaN(Date.parse(publishedAt))) throw releaseDescriptorError('release descriptor published_at must be an ISO-8601 timestamp');
    const artifact = normalizeReleaseArtifact(input.artifact, repository, tag, packagePath);

    if (options.type !== undefined && type !== normalizePackageType(options.type)) throw releaseDescriptorError('release descriptor type does not match expected package');
    if (options.id !== undefined && id !== normalizePackageId(options.id)) throw releaseDescriptorError('release descriptor id does not match expected package');
    if (options.version !== undefined && version !== String(options.version).trim().replace(/^v/, '')) throw releaseDescriptorError('release descriptor version does not match expected package');
    if (options.channel !== undefined && channel !== normalizeReleaseChannel(options.channel)) throw releaseDescriptorError('release descriptor channel does not match expected package');
    if (options.repository !== undefined && repository.toLowerCase() !== String(options.repository).trim().toLowerCase()) throw releaseDescriptorError('release descriptor repository does not match expected repository');
    if (options.commit !== undefined && commit !== String(options.commit).trim().toLowerCase()) throw releaseDescriptorError('release descriptor commit does not match expected commit');
    if (options.tag !== undefined && tag !== String(options.tag)) throw releaseDescriptorError('release descriptor tag does not match expected tag');
    if (options.package_path !== undefined && packagePath !== normalizePackagePath(options.package_path)) throw releaseDescriptorError('release descriptor package_path does not match expected package scope');

    return {
      release_version: PACKAGE_RELEASE_DESCRIPTOR_VERSION,
      protocol_version: 2,
      manifest_version: PACKAGE_MANIFEST_VERSION,
      id,
      type,
      version,
      channel,
      repository,
      commit,
      tag,
      published_at: new Date(publishedAt).toISOString(),
      manifest_file: manifestFile,
      package_path: packagePath,
      manifest,
      artifact,
    };
  } catch (error) {
    if (error?.code === 'DSH_RELEASE_DESCRIPTOR_INVALID') throw error;
    throw releaseDescriptorError(error instanceof Error ? error.message : String(error));
  }
}
