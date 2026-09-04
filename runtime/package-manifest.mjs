import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validatePackageManifest, PACKAGE_MANIFEST_SCHEMA_VERSION } from '../packages/protocol-core/manifest.mjs';
import { formatPackageCoordinate } from '../packages/protocol-core/index.mjs';

export const DSH_MANIFEST_FILES = Object.freeze(['dsh-package.json']);
export const DSH_MANIFEST_SCHEMA_VERSION = PACKAGE_MANIFEST_SCHEMA_VERSION;

function canonical(value) {
  const manifest = validatePackageManifest(value);
  return {
    schema_version: manifest.schema_version,
    type: manifest.type,
    id: manifest.id,
    version: manifest.version,
    channel: manifest.channel,
    runtime: manifest.runtime,
    entrypoints: manifest.entrypoints,
    capabilities: manifest.capabilities,
    permissions: manifest.permissions,
    dependencies: manifest.dependencies,
    compatibility: manifest.compatibility,
    metadata: manifest.metadata,
  };
}

export function normalizeDshManifest(manifest, options = {}) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('dsh-package.json must contain a JSON object');
  if (manifest.schema_version !== PACKAGE_MANIFEST_SCHEMA_VERSION) {
    const error = new Error(`unsupported dsh-package.json schema_version=${String(manifest.schema_version)}; Manifest V2 is required`);
    error.code = 'DSH_MANIFEST_SCHEMA_UNSUPPORTED';
    throw error;
  }
  const normalized = canonical(manifest);
  if (options.type && normalized.type !== String(options.type).trim().toLowerCase()) throw new Error(`manifest type mismatch: expected ${options.type}, got ${normalized.type}`);
  return normalized;
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

export async function findDshManifest(root) {
  const file = resolve(root, 'dsh-package.json');
  try { await access(file); return file; } catch { return null; }
}

export async function readDshManifest(root, options = {}) {
  const file = await findDshManifest(root);
  if (!file) {
    const error = new Error(`Manifest V2 is required: ${resolve(root, 'dsh-package.json')}`);
    error.code = 'DSH_MANIFEST_NOT_FOUND';
    throw error;
  }
  let parsed;
  try { parsed = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    const wrapped = new Error(`invalid JSON in ${file}: ${error.message}`);
    wrapped.code = 'DSH_MANIFEST_INVALID';
    throw wrapped;
  }
  const result = validateDshManifest(parsed, options);
  return { file, manifest: result.manifest, validation: result };
}

export function manifestSourceSummary(manifest = {}) {
  const normalized = normalizeDshManifest(manifest);
  return {
    coordinate: formatPackageCoordinate({ type: normalized.type, id: normalized.id, range: normalized.version, channel: normalized.channel }),
    schema_version: normalized.schema_version,
    runtime_type: normalized.runtime?.type || normalized.type,
    entrypoints: Object.keys(normalized.entrypoints || {}).sort(),
    capabilities: [...(normalized.capabilities || [])],
    permissions: [...(normalized.permissions || [])],
  };
}

export function createManifestTemplate(input = {}) {
  const type = input.type || 'plugin';
  const id = input.id || 'owner/package';
  const version = input.version || '0.1.0';
  return canonical({
    schema_version: PACKAGE_MANIFEST_SCHEMA_VERSION,
    type,
    id,
    version,
    channel: input.channel || 'stable',
    runtime: input.runtime || { type },
    entrypoints: input.entrypoints || {},
    capabilities: input.capabilities || [],
    permissions: input.permissions || [],
    dependencies: input.dependencies || [],
    compatibility: input.compatibility || {},
    metadata: input.metadata || {},
  });
}
