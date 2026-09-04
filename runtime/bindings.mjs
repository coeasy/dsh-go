import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizePackageId, normalizePackageType } from '../packages/protocol-core/index.mjs';
import { PACKAGE_MANIFEST_FILE, validatePackageManifest } from '../packages/protocol-core/manifest.mjs';

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

export async function discoverPackageManifest(target, type, options = {}) {
  const path = join(target, PACKAGE_MANIFEST_FILE);
  if (!await exists(path)) throw new Error(`${PACKAGE_MANIFEST_FILE} is required by Package Manifest V2`);
  let parsed;
  try { parsed = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { throw new Error(`invalid ${PACKAGE_MANIFEST_FILE}: ${error.message}`); }
  const manifest = validatePackageManifest(parsed, { type, id: options.id, version: options.version });
  return { file: PACKAGE_MANIFEST_FILE, format: 'json', manifest };
}

function runtimePermissions(lock) {
  const declared = new Set(Array.isArray(lock?.permissions) ? lock.permissions : []);
  return {
    network: [...declared].some((value) => String(value).startsWith('network:')),
    filesystem: [...declared].some((value) => String(value).startsWith('filesystem:')),
    process: [...declared].some((value) => String(value).startsWith('process:') || value === 'shell'),
  };
}

export function createRuntimeBinding({ type, id, target, lock, manifest }) {
  const normalizedType = normalizePackageType(type);
  const normalizedId = normalizePackageId(id);
  const validatedManifest = validatePackageManifest(manifest?.manifest, { type: normalizedType, id: normalizedId, version: lock?.version });
  const base = {
    id: normalizedId,
    type: normalizedType,
    target,
    transport: 'local',
    capabilities: [...(lock?.capabilities || validatedManifest.capabilities || [])],
    permissions: runtimePermissions(lock),
    declared_permissions: [...(lock?.permissions || validatedManifest.permissions || [])],
    manifest_file: PACKAGE_MANIFEST_FILE,
    manifest_format: 'json',
    manifest: validatedManifest,
  };

  if (normalizedType === 'plugin') return { ...base, kind: 'plugin', entrypoint: validatedManifest.entrypoints?.main || null };
  if (normalizedType === 'mcp') return { ...base, kind: 'mcp', entrypoint: validatedManifest.entrypoints?.main || null, transport_config: validatedManifest.runtime?.mcp || null };
  if (normalizedType === 'skill') return { ...base, kind: 'skill', entrypoint: validatedManifest.entrypoints?.main || null, executor: validatedManifest.runtime?.executor || null };
  return { ...base, kind: 'agent', entrypoint: validatedManifest.entrypoints?.main || null, workflow: validatedManifest.runtime?.workflow || null };
}

export function bindingIsSafe(binding) {
  return Boolean(binding)
    && binding.transport === 'local'
    && Boolean(binding.id)
    && Boolean(binding.type)
    && Boolean(binding.target)
    && binding.manifest_file === PACKAGE_MANIFEST_FILE
    && ['plugin', 'mcp', 'skill', 'agent'].includes(binding.type);
}
