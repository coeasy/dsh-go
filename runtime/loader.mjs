import { resolve } from 'node:path';
import { createRuntimeBinding, discoverPackageManifest, bindingIsSafe } from './bindings.mjs';
import { assertPackageType, packageKey, safePackageId } from './package-model.mjs';
import { activatePackage } from './platform.mjs';
import {
  getRuntimePackage,
  packagePath,
  readRuntimeRegistry,
  upsertRuntimePackage,
  writeRuntimeRegistry,
} from './registry.mjs';
import { readInstallLock, verifyInstalledCommit } from './verifier.mjs';

export async function loadInstalledPackage(type, id, options = {}) {
  const normalizedType = assertPackageType(type);
  const normalizedId = safePackageId(id);
  const runtimeRegistry = await readRuntimeRegistry(options.registryFile);
  const runtimeRecord = getRuntimePackage(runtimeRegistry, normalizedType, normalizedId, { includeRemoved: true });
  const key = packageKey(normalizedType, normalizedId);
  if (runtimeRecord?.state === 'removed') throw new Error(`runtime package is removed: ${key}`);
  if (runtimeRecord?.enabled === false || runtimeRecord?.state === 'disabled') throw new Error(`runtime package is disabled: ${key}`);

  const target = options.root
    ? packagePath(normalizedType, normalizedId, options.root)
    : runtimeRecord?.path
      ? resolve(runtimeRecord.path)
      : packagePath(normalizedType, normalizedId);
  const lock = await readInstallLock(target);
  if (lock.type !== normalizedType) throw new Error(`install lock type mismatch: expected ${normalizedType}, got ${lock.type}`);
  if (lock.id !== normalizedId) throw new Error(`install lock id mismatch: expected ${normalizedId}, got ${lock.id}`);
  if (options.version && lock.version !== options.version) {
    throw new Error(`installed version mismatch: expected ${options.version}, got ${lock.version}`);
  }
  await verifyInstalledCommit(target, lock.source.commit);

  const manifest = await discoverPackageManifest(target, normalizedType);
  const binding = createRuntimeBinding({
    type: normalizedType,
    id: normalizedId,
    target,
    lock,
    manifest,
  });
  if (!bindingIsSafe(binding)) throw new Error(`unsafe runtime binding: ${key}`);

  let activatedRecord = runtimeRecord;
  if (runtimeRecord) {
    activatedRecord = activatePackage(runtimeRecord, binding);
    await writeRuntimeRegistry(
      upsertRuntimePackage(runtimeRegistry, activatedRecord),
      options.registryFile,
    );
  }

  return {
    id: lock.id,
    type: normalizedType,
    version: lock.version,
    channel: lock.channel || activatedRecord?.channel || 'stable',
    target,
    commit: lock.source.commit,
    runtime: lock.runtime,
    capabilities: lock.capabilities || [],
    manifest_file: manifest.file,
    manifest: manifest.manifest,
    binding,
    activation: 'active',
    restart_required: activatedRecord?.restart_required ?? false,
    message: `Runtime package ${key} is installed, verified, bound locally, and activated by the client startup loader.`,
  };
}

export async function loadInstalledPlugin(id, options = {}) {
  const loaded = await loadInstalledPackage('plugin', id, options);
  return {
    ...loaded,
    message: 'Plugin source is installed, verified, and activated by the client startup loader.',
  };
}
