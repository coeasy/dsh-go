import {
  normalizePackageId,
  normalizePackageType,
  normalizeReleaseChannel,
  normalizeVersionRange,
  parseVersion,
} from './index.mjs';

export const PACKAGE_MANIFEST_SCHEMA_VERSION = 2;
export const PACKAGE_MANIFEST_FILE = 'dsh-package.json';

export function validatePackageManifest(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('package manifest must be an object');
  if (input.schema_version !== PACKAGE_MANIFEST_SCHEMA_VERSION) throw new Error(`unsupported package manifest schema: ${input.schema_version}`);
  const type = normalizePackageType(input.type);
  const id = normalizePackageId(input.id);
  const version = String(input.version || '').replace(/^v/, '');
  parseVersion(version);
  const channel = normalizeReleaseChannel(input.channel || 'stable');
  if (options.type && type !== normalizePackageType(options.type)) throw new Error(`package manifest type mismatch: expected ${options.type}, got ${type}`);
  if (options.id && id !== normalizePackageId(options.id)) throw new Error(`package manifest id mismatch: expected ${options.id}, got ${id}`);
  if (options.version && version !== String(options.version).replace(/^v/, '')) throw new Error(`package manifest version mismatch: expected ${options.version}, got ${version}`);

  const dependencies = (Array.isArray(input.dependencies) ? input.dependencies : []).map((dependency) => {
    if (!dependency || typeof dependency !== 'object') throw new Error('manifest dependency must be an object');
    return {
      type: normalizePackageType(dependency.type),
      id: normalizePackageId(dependency.id),
      range: normalizeVersionRange(dependency.range || '*'),
      optional: dependency.optional === true,
    };
  });
  const permissions = [...new Set((Array.isArray(input.permissions) ? input.permissions : []).map(String).map((value) => value.trim()).filter(Boolean))].sort();
  const capabilities = [...new Set((Array.isArray(input.capabilities) ? input.capabilities : []).map(String).map((value) => value.trim()).filter(Boolean))].sort();
  return {
    schema_version: PACKAGE_MANIFEST_SCHEMA_VERSION,
    type,
    id,
    version,
    channel,
    name: String(input.name || id),
    description: String(input.description || ''),
    runtime: input.runtime && typeof input.runtime === 'object' ? input.runtime : {},
    entrypoints: input.entrypoints && typeof input.entrypoints === 'object' ? input.entrypoints : {},
    capabilities,
    permissions,
    dependencies,
    compatibility: input.compatibility && typeof input.compatibility === 'object' ? input.compatibility : {},
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
  };
}
