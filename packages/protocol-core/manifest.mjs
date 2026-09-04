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
