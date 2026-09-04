import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validatePackageManifest, PACKAGE_MANIFEST_VERSION } from '../packages/protocol-core/manifest.mjs';
import { formatPackageCoordinate } from '../packages/protocol-core/index.mjs';

export const DSH_MANIFEST_FILES = Object.freeze(['dsh-package.json']);
export const DSH_MANIFEST_VERSION = PACKAGE_MANIFEST_VERSION;

function canonical(value, options = {}) {
  return validatePackageManifest(value, options);
}

export function normalizeDshManifest(manifest, options = {}) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('dsh-package.json must contain a JSON object');
  if ('schema_version' in manifest) {
    const error = new Error('legacy dsh-package.json schema_version is not supported; Manifest V2 requires manifest_version: 2');
    error.code = 'DSH_MANIFEST_VERSION_UNSUPPORTED';
    throw error;
  }
  if (manifest.manifest_version !== PACKAGE_MANIFEST_VERSION) {
    const error = new Error(`unsupported dsh-package.json manifest_version=${String(manifest.manifest_version)}; Manifest V2 is required`);
    error.code = 'DSH_MANIFEST_VERSION_UNSUPPORTED';
    throw error;
  }
  try {
    return canonical(manifest, options);
  } catch (error) {
    if (!error.code) error.code = 'DSH_MANIFEST_INVALID';
    throw error;
  }
}

export function validateDshManifest(manifest, options = {}) {
  const normalized = normalizeDshManifest(manifest, options);
  return {
    ok: true,
    errors: [],
    warnings: [],
    manifest: normalized,
    coordinate: formatPackageCoordinate({ type: normalized.type, id: normalized.id, range: normalized.version, channel: normalized.channel }),
  };
}

async function findManifestFile(root) {
  const file = resolve(root, 'dsh-package.json');
  try { await access(file); return file; } catch { return null; }
}

export async function findPackageManifest(root, options = {}) {
  const file = await findManifestFile(root);
  if (!file) return null;
  let parsed;
  try { parsed = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    const wrapped = new Error(`invalid JSON in ${file}: ${error.message}`);
    wrapped.code = 'DSH_MANIFEST_INVALID';
    throw wrapped;
  }
  const validation = validateDshManifest(parsed, options);
  return { path: file, file, manifest: validation.manifest, validation };
}

export async function readDshManifest(root, options = {}) {
  const found = await findPackageManifest(root, options);
  if (found) return { file: found.file, manifest: found.manifest, validation: found.validation };
  const error = new Error(`Manifest V2 is required: ${resolve(root, 'dsh-package.json')}`);
  error.code = 'DSH_MANIFEST_NOT_FOUND';
  throw error;
}

export function manifestSourceSummary(manifest = {}) {
  const normalized = normalizeDshManifest(manifest);
  return {
    coordinate: formatPackageCoordinate({ type: normalized.type, id: normalized.id, range: normalized.version, channel: normalized.channel }),
    manifest_version: normalized.manifest_version,
    name: normalized.name,
    publisher: normalized.publisher.id,
    runtime_type: normalized.runtime.type,
    entrypoints: Object.keys(normalized.entrypoints).sort(),
    capabilities: [...normalized.capabilities],
    permissions: [...normalized.permissions],
    security_evidence: Object.keys(normalized.security).sort(),
  };
}

export function createManifestTemplate(input = {}) {
  const type = input.type || 'plugin';
  const id = input.id || 'owner/package';
  const version = input.version || '0.1.0';
  const publisherId = input.publisher?.id || String(id).split('/')[0] || 'publisher';
  return canonical({
    manifest_version: PACKAGE_MANIFEST_VERSION,
    type,
    id,
    version,
    channel: input.channel || 'stable',
    name: input.name || id,
    description: input.description || '',
    runtime: input.runtime || { type },
    entrypoints: input.entrypoints || {},
    capabilities: input.capabilities || [],
    permissions: input.permissions || [],
    dependencies: input.dependencies || [],
    compatibility: input.compatibility || {},
    publisher: input.publisher || { id: publisherId },
    security: input.security || {},
    metadata: input.metadata || {},
    ...(input.source ? { source: input.source } : {}),
    ...(input.release ? { release: input.release } : {}),
    ...(input.permission_policy ? { permission_policy: input.permission_policy } : {}),
    ...(input.localization ? { localization: input.localization } : {}),
    ...(input.conflicts ? { conflicts: input.conflicts } : {}),
    ...(input.replaces ? { replaces: input.replaces } : {}),
    ...(input.provides ? { provides: input.provides } : {}),
    ...(input[type] ? { [type]: input[type] } : {}),
  });
}
