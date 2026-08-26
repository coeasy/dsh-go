import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertPackageType, manifestCandidates } from './package-model.mjs';

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function discoverPackageManifest(target, type) {
  for (const candidate of manifestCandidates(type)) {
    const path = join(target, candidate.file);
    if (!await exists(path)) continue;
    if (candidate.format === 'json') {
      try {
        return { file: candidate.file, format: 'json', manifest: JSON.parse(await readFile(path, 'utf8')) };
      } catch (error) {
        throw new Error(`invalid ${candidate.file}: ${error.message}`);
      }
    }
    return { file: candidate.file, format: candidate.format, manifest: null };
  }
  return { file: null, format: null, manifest: null };
}

function runtimePermissions(lock) {
  const permissions = lock?.runtime?.permissions;
  if (!permissions || typeof permissions !== 'object') return { network: false, filesystem: false, process: false };
  return {
    network: permissions.network === true,
    filesystem: permissions.filesystem === true,
    process: permissions.process === true,
  };
}

export function createRuntimeBinding({ type, id, target, lock, manifest }) {
  const normalizedType = assertPackageType(type);
  const base = {
    id,
    type: normalizedType,
    target,
    transport: 'local',
    capabilities: [...(lock?.capabilities || [])],
    permissions: runtimePermissions(lock),
    manifest_file: manifest?.file || null,
    manifest_format: manifest?.format || null,
  };

  if (normalizedType === 'plugin') {
    return { ...base, kind: 'plugin', entrypoint: manifest?.file || null, manifest: manifest?.manifest || null };
  }
  if (normalizedType === 'mcp') {
    return {
      ...base,
      kind: 'mcp',
      entrypoint: manifest?.file || null,
      transport_config: lock?.runtime?.mcp || lock?.runtime?.transport || null,
      manifest: manifest?.manifest || null,
    };
  }
  if (normalizedType === 'skill') {
    return {
      ...base,
      kind: 'skill',
      entrypoint: manifest?.file || 'SKILL.md',
      manifest: manifest?.manifest || null,
    };
  }
  return {
    ...base,
    kind: 'agent',
    entrypoint: manifest?.file || null,
    workflow: lock?.runtime?.agent || null,
    manifest: manifest?.manifest || null,
  };
}

export function bindingIsSafe(binding) {
  if (!binding || binding.transport !== 'local') return false;
  if (!binding.id || !binding.type || !binding.target) return false;
  return ['plugin', 'mcp', 'skill', 'agent'].includes(binding.type);
}
