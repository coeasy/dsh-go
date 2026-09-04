import { rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { normalizePackageRequest, packageKey, parsePackageCoordinate } from '../packages/protocol-core/index.mjs';
import { resolvePackage } from '../packages/resolver/index.mjs';
import { installPackage } from './installer.mjs';
import { createRuntimePackageRecord, recordRuntimeEvent, transitionPackage } from './lifecycle.mjs';
import {
  getRuntimePackage,
  markRuntimePackageRemoved,
  packagePath,
  readRuntimeRegistry,
  updateRuntimeRegistry,
  upsertRuntimePackage,
} from './registry.mjs';
import { loadRuntimeRegistryV4 } from './registry-client.mjs';
import { readInstallLock, verifyInstalledCommit } from './verifier.mjs';

function requestFrom(value, options = {}) {
  return typeof value === 'string'
    ? parsePackageCoordinate(value, { channel: options.channel || 'stable', registry: options.registry })
    : normalizePackageRequest({ ...value, channel: value?.channel || options.channel || 'stable', registry: value?.registry || options.registry });
}

function installRecord(node, result, plan) {
  const base = createRuntimePackageRecord(node.type, node.id, node.version, {
    channel: node.channel,
    state: 'pending-restart',
    enabled: true,
    activated: false,
    restart_required: true,
    path: result.target,
    source: node.source,
    commit: node.commit,
    runtime: node.runtime || {},
    entrypoints: node.entrypoints || {},
    capabilities: node.capabilities || [],
    dependencies: node.dependencies || [],
    permissions: node.permissions || [],
    compatibility: node.compatibility || {},
    publisher: node.publisher || (node.publisher_id ? { id: node.publisher_id } : null),
    security: node.security || null,
    artifact: node.artifact || null,
    registry_revision: plan.registry_revision,
    resolution_hash: plan.resolution_hash,
    health: { status: 'pending-restart', checked_at: new Date().toISOString() },
  });
  return recordRuntimeEvent(base, 'installed', { registry_revision: plan.registry_revision, resolution_hash: plan.resolution_hash });
}

export async function planPackage(value, options = {}) {
  const request = requestFrom(value, options);
  const registry = options.registryData || await loadRuntimeRegistryV4(options);
  return resolvePackage(registry, request, options.environment || {});
}

export async function installPackageRequest(value, options = {}) {
  const request = requestFrom(value, options);
  const registry = options.registryData || await loadRuntimeRegistryV4(options);
  const plan = resolvePackage(registry, request, options.environment || {});
  if (options.dryRun) return { operation: 'install', request, plan, changed: false };
  if (options.approved !== true) {
    const error = new Error('local installation requires explicit approval');
    error.code = 'DSH_PERMISSION_DENIED';
    throw error;
  }

  const nodes = new Map(plan.graph.map((node) => [node.key, node]));
  const installed = [];
  try {
    for (const key of plan.order) {
      const node = nodes.get(key);
      const currentState = await readRuntimeRegistry(options.registryFile);
      const current = getRuntimePackage(currentState, node.type, node.id, { includeRemoved: true });
      const force = options.force === true || Boolean(current && current.state !== 'removed');
      const result = await installPackage({
        ...node,
        repo: node.source?.repo,
        commit: node.commit,
        source: { ...(node.source || {}), provider: node.source?.provider || 'github', commit: node.commit },
        registry_revision: plan.registry_revision,
        resolution_hash: plan.resolution_hash,
      }, {
        ...options,
        approved: true,
        force,
      });
      const record = installRecord(node, result, plan);
      await updateRuntimeRegistry((state) => upsertRuntimePackage(state, record), options.registryFile);
      installed.push({ key, target: result.target, previous: current || null });
    }
    return { operation: 'install', request, plan, installed: installed.map((item) => item.key), changed: true, restart_required: true };
  } catch (error) {
    for (const item of installed.reverse()) {
      await rm(item.target, { recursive: true, force: true }).catch(() => {});
      await updateRuntimeRegistry((state) => {
        if (item.previous) return upsertRuntimePackage(state, item.previous);
        return markRuntimePackageRemoved(state, ...item.key.split(':'), { reason: 'install-transaction-rollback' });
      }, options.registryFile).catch(() => {});
    }
    error.rollback_attempted = installed.length > 0;
    throw error;
  }
}

export async function updatePackageRequest(coordinate, options = {}) {
  const request = requestFrom(coordinate, options);
  return installPackageRequest({ ...request, range: request.range === '*' ? '*' : request.range }, { ...options, force: true });
}

export async function removePackageRequest(coordinate, options = {}) {
  const request = requestFrom(coordinate, options);
  const state = await readRuntimeRegistry(options.registryFile);
  const current = getRuntimePackage(state, request.type, request.id, { includeRemoved: true });
  if (!current || current.state === 'removed') return { operation: 'remove', changed: false, key: packageKey(request.type, request.id) };
  if (options.approved !== true) {
    const error = new Error('local removal requires explicit approval');
    error.code = 'DSH_PERMISSION_DENIED';
    throw error;
  }
  const target = current.path ? resolve(current.path) : packagePath(current.type, current.id);
  await rm(target, { recursive: true, force: true });
  await updateRuntimeRegistry((latest) => markRuntimePackageRemoved(latest, current.type, current.id, { version: current.version }), options.registryFile);
  return { operation: 'remove', changed: true, key: packageKey(current.type, current.id), restart_required: current.activated === true };
}

export async function setPackageEnabled(coordinate, enabled, options = {}) {
  const request = requestFrom(coordinate, options);
  const result = await updateRuntimeRegistry((state) => {
    const current = getRuntimePackage(state, request.type, request.id, { includeRemoved: true });
    if (!current || current.state === 'removed') throw new Error(`runtime package is not installed: ${packageKey(request.type, request.id)}`);
    const nextState = enabled ? 'pending-restart' : 'disabled';
    const transitioned = transitionPackage(current, nextState, {
      event: enabled ? 'enabled' : 'disabled',
      patch: { enabled, activated: false, restart_required: true, binding: null },
    });
    return upsertRuntimePackage(state, transitioned);
  }, options.registryFile);
  return { operation: enabled ? 'enable' : 'disable', changed: true, key: packageKey(request.type, request.id), generation: result.generation, restart_required: true };
}

export async function listPackages(options = {}) {
  const state = await readRuntimeRegistry(options.registryFile);
  return state.packages.filter((item) => options.all === true || item.state !== 'removed').sort((a, b) => packageKey(a.type, a.id).localeCompare(packageKey(b.type, b.id)));
}

export async function packageInfo(coordinate, options = {}) {
  const request = requestFrom(coordinate, options);
  const state = await readRuntimeRegistry(options.registryFile);
  const item = getRuntimePackage(state, request.type, request.id, { includeRemoved: true });
  if (!item) throw new Error(`runtime package is not installed: ${packageKey(request.type, request.id)}`);
  return item;
}

export async function verifyPackageRequest(coordinate, options = {}) {
  const item = await packageInfo(coordinate, options);
  if (item.state === 'removed') throw new Error(`runtime package is removed: ${packageKey(item.type, item.id)}`);
  const target = item.path ? resolve(item.path) : packagePath(item.type, item.id);
  const lock = await readInstallLock(target);
  const commit = await verifyInstalledCommit(target, lock.source.commit, options);
  return { key: packageKey(item.type, item.id), version: item.version, commit, install_lock: lock, ok: true };
}

export async function rollbackPackageRequest(coordinate, options = {}) {
  const item = await packageInfo(coordinate, options);
  if (options.approved !== true) {
    const error = new Error('local rollback requires explicit approval');
    error.code = 'DSH_PERMISSION_DENIED';
    throw error;
  }
  const target = item.path ? resolve(item.path) : packagePath(item.type, item.id);
  const backup = `${target}.backup`;
  const displaced = `${target}.rollback-displaced-${Date.now()}`;
  await rename(target, displaced);
  try {
    await rename(backup, target);
    const lock = await readInstallLock(target);
    await verifyInstalledCommit(target, lock.source.commit, options);
    await rm(displaced, { recursive: true, force: true });
    const next = recordRuntimeEvent({
      ...item,
      version: lock.version,
      channel: lock.channel,
      path: target,
      source: lock.source,
      commit: lock.source.commit,
      state: 'pending-restart',
      activated: false,
      restart_required: true,
      binding: null,
    }, 'rollback', { from_version: item.version, to_version: lock.version });
    await updateRuntimeRegistry((state) => upsertRuntimePackage(state, next), options.registryFile);
    return { operation: 'rollback', key: packageKey(item.type, item.id), from_version: item.version, to_version: lock.version, restart_required: true };
  } catch (error) {
    await rm(target, { recursive: true, force: true }).catch(() => {});
    await rename(displaced, target).catch(() => {});
    throw error;
  }
}

export async function runtimeStatus(options = {}) {
  const state = await readRuntimeRegistry(options.registryFile);
  const counts = {};
  for (const item of state.packages) counts[item.state] = (counts[item.state] || 0) + 1;
  return { schema_version: state.schema_version, generation: state.generation, updated_at: state.updated_at, package_count: state.packages.length, states: counts };
}
