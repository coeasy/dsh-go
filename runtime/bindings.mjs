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
  const legacy = lock?.runtime?.permissions;
  const declared = new Set(Array.isArray(lock?.permissions) ? lock.permissions : []);
  return {
    network: legacy?.network === true || declared.has('network') || declared.has('network.unrestricted'),
    filesystem: legacy?.filesystem === true || declared.has('filesystem.read') || declared.has('filesystem.write'),
    process: legacy?.process === true || declared.has('process.spawn') || declared.has('shell'),
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
    declared_permissions: [...(lock?.permissions || [])],
    permission_policy: lock?.permission_policy || null,
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
      transport_config: manifest?.manifest?.mcp || lock?.type_config || lock?.runtime?.mcp || lock?.runtime?.transport || null,
      manifest: manifest?.manifest || null,
    };
  }
  if (normalizedType === 'skill') {
    return {
      ...base,
      kind: 'skill',
      entrypoint: manifest?.manifest?.skill?.entrypoint || manifest?.file || 'SKILL.md',
      executor: manifest?.manifest?.skill?.executor || lock?.type_config?.executor || null,
      manifest: manifest?.manifest || null,
    };
  }
  return {
    ...base,
    kind: 'agent',
    entrypoint: manifest?.manifest?.agent?.entrypoint || manifest?.file || null,
    workflow: manifest?.manifest?.agent?.workflow || lock?.type_config?.workflow || lock?.runtime?.agent || null,
    manifest: manifest?.manifest || null,
  };
}

export function bindingIsSafe(binding) {
  if (!binding || binding.transport !== 'local') return false;
  if (!binding.id || !binding.type || !binding.target) return false;
  return ['plugin', 'mcp', 'skill', 'agent'].includes(binding.type);
}
