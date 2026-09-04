import { access, mkdir, open, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createRuntimePackageRecord, recordRuntimeEvent } from './lifecycle.mjs';
import { lockOwnerAlive } from './file-lock.mjs';
import { normalizePackageId, normalizePackageType, packageKey } from '../packages/protocol-core/index.mjs';
import { readInstallLock } from './verifier.mjs';

export const RUNTIME_STATE_SCHEMA_VERSION = 4;
const REGISTRY_LOCK_STALE_MS = 30_000;
const REGISTRY_LOCK_TIMEOUT_MS = 5_000;

export function runtimeRoot() {
  return resolve(process.env.DSH_RUNTIME_HOME || join(homedir(), '.dsh'));
}

export function registryPath() {
  return resolve(process.env.DSH_RUNTIME_REGISTRY || join(runtimeRoot(), 'state', 'runtime-v4.json'));
}

export function registryLockPath(file = registryPath()) {
  return `${resolve(file)}.lock`;
}

export function packageRoot(type) {
  const normalizedType = normalizePackageType(type);
  const base = resolve(process.env.DSH_PACKAGE_HOME || join(runtimeRoot(), 'packages'));
  return join(base, normalizedType);
}

function normalizeRecord(item) {
  const type = normalizePackageType(item?.type);
  const id = normalizePackageId(item?.id);
  const version = String(item?.version || '').trim();
  if (!version) throw new Error(`runtime package version is required: ${type}:${id}`);
  const base = createRuntimePackageRecord(type, id, version);
  const state = item.state || 'installed';
  return {
    ...base,
    ...item,
    id,
    type,
    version,
    state,
    channel: item.channel || 'stable',
    enabled: item.enabled ?? (state !== 'disabled' && state !== 'removed'),
    activated: item.activated ?? false,
    restart_required: item.restart_required ?? false,
    health: item.health || null,
    rollback: item.rollback || null,
    binding: item.binding || null,
    capabilities: Array.isArray(item.capabilities) ? item.capabilities : [],
    dependencies: Array.isArray(item.dependencies) ? item.dependencies : [],
    permissions: Array.isArray(item.permissions) ? item.permissions : [],
    compatibility: item.compatibility && typeof item.compatibility === 'object' ? item.compatibility : {},
    publisher: item.publisher || null,
    security: item.security || null,
    artifact: item.artifact || null,
    resolution_hash: item.resolution_hash || null,
    registry_revision: item.registry_revision || null,
    history: Array.isArray(item.history) && item.history.length ? item.history.slice(-100) : base.history,
  };
}

async function hydrateRecordFromInstallLock(item) {
  if (!item?.path || item.state === 'removed') return item;
  try {
    const lock = await readInstallLock(resolve(item.path));
    const type = normalizePackageType(item.type);
    const id = normalizePackageId(item.id);
    if (lock.type !== type || lock.id !== id || lock.version !== item.version) return item;
    if (item.commit && String(lock.source.commit).toLowerCase() !== String(item.commit).toLowerCase()) return item;
    return {
      ...item,
      channel: lock.channel || item.channel || 'stable',
      source: lock.source || item.source,
      commit: lock.source.commit,
      runtime: lock.runtime || {},
      capabilities: lock.capabilities || [],
      dependencies: lock.dependencies || [],
      permissions: lock.permissions || [],
      compatibility: lock.compatibility || {},
      publisher: lock.publisher || null,
      security: lock.security || null,
      artifact: lock.artifact || null,
      installed_at: lock.installed_at || item.installed_at,
    };
  } catch {
    return item;
  }
}

export function validateRuntimeState(data) {
  if (!data || typeof data !== 'object') throw new Error('invalid runtime state');
  if (data.schema_version !== RUNTIME_STATE_SCHEMA_VERSION) {
    const error = new Error(`unsupported runtime state schema: ${data.schema_version}; expected ${RUNTIME_STATE_SCHEMA_VERSION}`);
    error.code = 'DSH_STATE_SCHEMA_UNSUPPORTED';
    throw error;
  }
  if (!Array.isArray(data.packages)) throw new Error('runtime state packages must be an array');
  if ('plugins' in data) throw new Error('runtime state contains removed legacy plugins mirror');
  const seen = new Set();
  const packages = data.packages.map((item) => {
    const normalized = normalizeRecord(item);
    const key = packageKey(normalized.type, normalized.id);
    if (seen.has(key)) throw new Error(`duplicate runtime package: ${key}`);
    seen.add(key);
    return normalized;
  });
  return {
    schema_version: RUNTIME_STATE_SCHEMA_VERSION,
    generation: Number(data.generation) || 0,
    updated_at: data.updated_at || new Date().toISOString(),
    packages,
  };
}

async function hydrateState(state) {
  const packages = [];
  for (const item of state.packages) packages.push(normalizeRecord(await hydrateRecordFromInstallLock(item)));
  return { ...state, packages };
}

export async function readRuntimeRegistry(file = registryPath()) {
  try {
    return hydrateState(validateRuntimeState(JSON.parse(await readFile(file, 'utf8'))));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { schema_version: RUNTIME_STATE_SCHEMA_VERSION, generation: 0, updated_at: new Date().toISOString(), packages: [] };
    }
    throw error;
  }
}

async function diskGeneration(file) {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (data.schema_version !== RUNTIME_STATE_SCHEMA_VERSION) {
      const error = new Error(`unsupported runtime state schema: ${data.schema_version}`);
      error.code = 'DSH_STATE_SCHEMA_UNSUPPORTED';
      throw error;
    }
    return Number(data.generation) || 0;
  } catch (error) {
    if (error?.code === 'ENOENT') return 0;
    throw error;
  }
}

async function acquireRegistryLock(file, options = {}) {
  const lockFile = registryLockPath(file);
  const requestedTimeout = Number(options.timeoutMs);
  const timeout = Number.isFinite(requestedTimeout) && requestedTimeout > 0 ? requestedTimeout : REGISTRY_LOCK_TIMEOUT_MS;
  const deadline = Date.now() + timeout;
  await mkdir(dirname(lockFile), { recursive: true });
  while (true) {
    try {
      const handle = await open(lockFile, 'wx', 0o600);
      try {
        await handle.writeFile(`${JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })}\n`);
      } catch (writeError) {
        await handle.close().catch(() => {});
        await unlink(lockFile).catch(() => {});
        throw writeError;
      }
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try { await handle.close(); } finally { await unlink(lockFile).catch(() => {}); }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const info = await stat(lockFile);
        if (Date.now() - info.mtimeMs > REGISTRY_LOCK_STALE_MS) {
          const ownerAlive = await lockOwnerAlive(lockFile);
          if (ownerAlive === null) continue;
          if (ownerAlive === false) {
            await unlink(lockFile);
            continue;
          }
        }
      } catch (inspectError) {
        if (inspectError?.code === 'ENOENT') continue;
        throw inspectError;
      }
      if (Date.now() >= deadline) {
        const busy = new Error(`runtime state is busy: ${file}`);
        busy.code = 'DSH_TRANSACTION_CONFLICT';
        throw busy;
      }
      await new Promise((accept) => setTimeout(accept, 50));
    }
  }
}

export async function writeRuntimeRegistry(state, file = registryPath(), options = {}) {
  const targetFile = resolve(file);
  const release = await acquireRegistryLock(targetFile, options);
  try {
    const currentGeneration = await diskGeneration(targetFile);
    const expectedGeneration = Number(state.generation);
    if (!options.force && Number.isFinite(expectedGeneration) && expectedGeneration !== currentGeneration) {
      const conflict = new Error(`runtime state generation conflict: expected ${expectedGeneration}, current ${currentGeneration}`);
      conflict.code = 'DSH_TRANSACTION_CONFLICT';
      conflict.expected_generation = expectedGeneration;
      conflict.current_generation = currentGeneration;
      throw conflict;
    }
    if ('plugins' in state) throw new Error('legacy plugins mirror is not accepted by Runtime State V4');
    const seen = new Set();
    const packages = [];
    for (const item of state.packages || []) {
      const normalized = normalizeRecord(await hydrateRecordFromInstallLock(item));
      const key = packageKey(normalized.type, normalized.id);
      if (seen.has(key)) throw new Error(`duplicate runtime package: ${key}`);
      seen.add(key);
      packages.push(normalized);
    }
    const next = {
      schema_version: RUNTIME_STATE_SCHEMA_VERSION,
      generation: currentGeneration + 1,
      updated_at: new Date().toISOString(),
      packages,
    };
    await mkdir(dirname(targetFile), { recursive: true });
    const temp = `${targetFile}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
    try {
      await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      await rename(temp, targetFile);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {});
      throw error;
    }
    return next;
  } finally {
    await release();
  }
}

export async function updateRuntimeRegistry(mutator, file = registryPath(), options = {}) {
  if (typeof mutator !== 'function') throw new TypeError('runtime state mutator must be a function');
  const attempts = Number.isInteger(options.retries) && options.retries > 0 ? options.retries : 5;
  let lastConflict;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const current = await readRuntimeRegistry(file);
    const next = await mutator(current);
    try {
      return await writeRuntimeRegistry(next, file, options);
    } catch (error) {
      if (error?.code !== 'DSH_TRANSACTION_CONFLICT' || attempt === attempts - 1) throw error;
      lastConflict = error;
      await new Promise((accept) => setTimeout(accept, 20 * (attempt + 1)));
    }
  }
  throw lastConflict || new Error('runtime state update did not converge');
}

export function getRuntimePackage(state, type, id, options = {}) {
  const key = packageKey(type, id);
  const item = state.packages.find((entry) => packageKey(entry.type, entry.id) === key);
  if (!item || (!options.includeRemoved && item.state === 'removed')) return null;
  return normalizeRecord(item);
}

export function findRuntimePackage(state, id, options = {}) {
  const normalizedId = normalizePackageId(id);
  const matches = state.packages
    .filter((entry) => entry.id === normalizedId)
    .filter((entry) => options.includeRemoved || entry.state !== 'removed')
    .map(normalizeRecord);
  if (options.type) return matches.find((entry) => entry.type === normalizePackageType(options.type)) || null;
  if (matches.length > 1) throw new Error(`runtime package id is ambiguous; specify type: ${id}`);
  return matches[0] || null;
}

export function upsertRuntimePackage(state, item) {
  const next = normalizeRecord(item);
  const key = packageKey(next.type, next.id);
  const packages = state.packages.map(normalizeRecord).filter((entry) => packageKey(entry.type, entry.id) !== key);
  return { ...state, packages: [...packages, next] };
}

export function markRuntimePackageRemoved(state, type, id, details = {}) {
  const current = getRuntimePackage(state, type, id, { includeRemoved: true });
  if (!current) throw new Error(`runtime package is not installed: ${type}:${id}`);
  const removed = recordRuntimeEvent(
    { ...current, state: 'removed', enabled: false, activated: false, restart_required: true, health: null, binding: null },
    'removed',
    details,
  );
  return upsertRuntimePackage(state, removed);
}

export function packagePath(type, id, root = packageRoot(type)) {
  return join(resolve(root), ...normalizePackageId(id).split('/'));
}

export async function removePath(path) {
  await rm(path, { recursive: true, force: true });
}

export async function pathExists(path) {
  try { await access(path); return true; } catch { return false; }
}
