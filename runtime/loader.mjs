import { resolve } from 'node:path';
import { createRuntimeBinding, discoverPackageManifest, bindingIsSafe } from './bindings.mjs';
import { normalizePackageId, normalizePackageType, packageKey } from '../packages/protocol-core/index.mjs';
import { activatePackage } from './platform.mjs';
import {
  getRuntimePackage,
  packagePath,
  readRuntimeRegistry,
  updateRuntimeRegistry,
  upsertRuntimePackage,
} from './registry.mjs';
import { readInstallLock, verifyInstalledCommit } from './verifier.mjs';
import { assertCompatibility } from './compatibility.mjs';
import { withPackageOperationLock } from './package-operation-lock.mjs';

function hydrateRuntimeRecord(record, lock, target) {
  return {
    ...record,
    id: lock.id,
    type: lock.type,
    version: lock.version,
    channel: lock.channel,
    path: target,
    source: lock.source,
    commit: lock.source.commit,
    runtime: lock.runtime || {},
    entrypoints: lock.entrypoints || {},
    capabilities: lock.capabilities || [],
    dependencies: lock.dependencies || [],
    permissions: lock.permissions || [],
    compatibility: lock.compatibility || {},
    publisher: lock.publisher || null,
    security: lock.security || null,
    artifact: lock.artifact || null,
    resolution_hash: lock.resolution_hash || null,
    registry_revision: lock.registry_revision || null,
  };
}

async function loadInstalledPackageUnlocked(type, id, options = {}) {
  const normalizedType = normalizePackageType(type);
  const normalizedId = normalizePackageId(id);
  const runtimeRegistry = await readRuntimeRegistry(options.registryFile);
  const runtimeRecord = getRuntimePackage(runtimeRegistry, normalizedType, normalizedId, { includeRemoved: true });
  const key = packageKey(normalizedType, normalizedId);
  if (!runtimeRecord) throw new Error(`runtime package is not installed: ${key}`);
  if (runtimeRecord.state === 'removed') throw new Error(`runtime package is removed: ${key}`);
  if (runtimeRecord.enabled === false || runtimeRecord.state === 'disabled') throw new Error(`runtime package is disabled: ${key}`);

  const target = options.root
    ? packagePath(normalizedType, normalizedId, options.root)
    : runtimeRecord.path
      ? resolve(runtimeRecord.path)
      : packagePath(normalizedType, normalizedId);
  const lock = await readInstallLock(target);
  if (lock.type !== normalizedType) throw new Error(`install lock type mismatch: expected ${normalizedType}, got ${lock.type}`);
  if (lock.id !== normalizedId) throw new Error(`install lock id mismatch: expected ${normalizedId}, got ${lock.id}`);
  if (options.version && lock.version !== options.version) throw new Error(`installed version mismatch: expected ${options.version}, got ${lock.version}`);
  await verifyInstalledCommit(target, lock.source.commit, options);
  const compatibility = assertCompatibility(lock, options.environment);

  const manifest = await discoverPackageManifest(target, normalizedType);
  const binding = createRuntimeBinding({ type: normalizedType, id: normalizedId, target, lock, manifest });
  if (!bindingIsSafe(binding)) throw new Error(`unsafe runtime binding: ${key}`);

  const hydrated = hydrateRuntimeRecord(runtimeRecord, lock, target);
  const activatedRecord = activatePackage(hydrated, binding);
  await updateRuntimeRegistry((current) => upsertRuntimePackage(current, activatedRecord), options.registryFile);

  return {
    key,
    id: lock.id,
    type: normalizedType,
    version: lock.version,
    channel: lock.channel,
    target,
    commit: lock.source.commit,
    runtime: lock.runtime || {},
    entrypoints: lock.entrypoints || {},
    capabilities: lock.capabilities || [],
    permissions: lock.permissions || [],
    compatibility,
    publisher: lock.publisher || null,
    security: lock.security || null,
    artifact: lock.artifact || null,
    registry_revision: lock.registry_revision || null,
    resolution_hash: lock.resolution_hash || null,
    manifest_file: manifest.file,
    manifest: manifest.manifest,
    binding,
    activation: 'active',
    activation_state: 'active',
    restart_required: activatedRecord.restart_required ?? false,
  };
}

export function loadInstalledPackage(type, id, options = {}) {
  const normalizedType = normalizePackageType(type);
  const normalizedId = normalizePackageId(id);
  return withPackageOperationLock(normalizedType, normalizedId, () => loadInstalledPackageUnlocked(normalizedType, normalizedId, options), options);
}
