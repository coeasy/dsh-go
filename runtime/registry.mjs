import { access, mkdir, open, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createRuntimePackageRecord, recordRuntimeEvent } from './lifecycle.mjs';
import { assertPackageType, packageKey, safePackageId } from './package-model.mjs';
import { readInstallLock } from './verifier.mjs';

export const RUNTIME_REGISTRY_SCHEMA_VERSION = 3;
const REGISTRY_LOCK_STALE_MS = 30_000;
const REGISTRY_LOCK_TIMEOUT_MS = 5_000;

export function runtimeRoot() {
  return resolve(process.env.DSH_RUNTIME_HOME || join(homedir(), '.dsh'));
}

function looksLikeCatalogRegistrySource(value) {
  const input = String(value || '').trim();
  if (!input) return false;
  return /^https?:\/\//i.test(input)
    || /(?:^|[\\/])catalog[\\/]/i.test(input)
    || /registry-v\d+\.json(?:$|[?#])/i.test(input);
}

export function runtimeRegistryEnv() {
  const explicit = String(process.env.DSH_RUNTIME_REGISTRY || '').trim();
  if (explicit) return { name: 'DSH_RUNTIME_REGISTRY', value: explicit, legacy: false };
  const legacy = String(process.env.DSH_REGISTRY || '').trim();
  if (!legacy || looksLikeCatalogRegistrySource(legacy)) return null;
  return { name: 'DSH_REGISTRY', value: legacy, legacy: true };
}

export function registryPath() {
  const configured = runtimeRegistryEnv();
  return resolve(configured?.value || join(runtimeRoot(), 'registry', 'runtime.json'));
}

export function registryLockPath(file = registryPath()) {
  return `${resolve(file)}.lock`;
}

export function pluginRoot() {
  return resolve(process.env.DSH_PLUGIN_HOME || join(runtimeRoot(), 'plugins'));
}

export function packageRoot(type) {
  const normalizedType = assertPackageType(type);
  if (normalizedType === 'plugin') return pluginRoot();
  const explicit = {
    mcp: process.env.DSH_MCP_HOME,
    skill: process.env.DSH_SKILL_HOME,
    agent: process.env.DSH_AGENT_HOME,
  }[normalizedType];
  if (explicit) return resolve(explicit);
  const base = resolve(process.env.DSH_PACKAGE_HOME || join(runtimeRoot(), 'packages'));
  return join(base, normalizedType);
}

function normalizeRecord(item) {
  const type = assertPackageType(item?.type || 'plugin');
  const id = safePackageId(item?.id);
  const base = createRuntimePackageRecord(type, id, item.version || '0.1.0');
  const state = item.state || 'installed';
  return {
    ...base,
    ...item,
    id,
    type,
    state,
    channel: item.channel || 'stable',
    enabled: item.enabled ?? (state !== 'disabled' && state !== 'removed'),
    activated: item.activated ?? false,
    restart_required: item.restart_required ?? item.restartRequired ?? false,
    health: item.health || null,
    rollback: item.rollback || null,
    binding: item.binding || null,
    capabilities: Array.isArray(item.capabilities) ? item.capabilities : [],
    dependencies: Array.isArray(item.dependencies) ? item.dependencies : [],
    permissions: Array.isArray(item.permissions) ? item.permissions : [],
    permission_policy: item.permission_policy && typeof item.permission_policy === 'object' ? item.permission_policy : null,
    permission_manifest: item.permission_manifest && typeof item.permission_manifest === 'object' ? item.permission_manifest : null,
    compatibility: item.compatibility && typeof item.compatibility === 'object' ? item.compatibility : {},
    conflicts: Array.isArray(item.conflicts) ? item.conflicts : [],
    replaces: Array.isArray(item.replaces) ? item.replaces : [],
    provides: Array.isArray(item.provides) ? item.provides : [],
    publisher: item.publisher || null,
    security: item.security || null,
    type_config: item.type_config || null,
    history: Array.isArray(item.history) && item.history.length ? item.history.slice(-100) : base.history,
  };
}

function withCompatibility(registry) {
  const packages = (registry.packages || []).map(normalizeRecord);
  return {
    ...registry,
    packages,
    plugins: packages.filter((item) => item.type === 'plugin'),
  };
}

async function hydrateRecordFromInstallLock(item) {
  if (!item?.path || item.state === 'removed') return item;
  try {
    const lock = await readInstallLock(resolve(item.path));
    const type = assertPackageType(item.type || 'plugin');
    const id = safePackageId(item.id);
    if (lock.type !== type || lock.id !== id) return item;
    if (item.version && lock.version !== item.version) return item;
    if (item.commit && String(lock.source.commit).toLowerCase() !== String(item.commit).toLowerCase()) return item;
    return {
      ...item,
      version: lock.version,
      channel: lock.channel || item.channel || 'stable',
      source: lock.source || item.source,
      commit: lock.source.commit,
      runtime: lock.runtime || {},
      capabilities: lock.capabilities || [],
      dependencies: lock.dependencies || [],
      permissions: lock.permissions || [],
      permission_policy: lock.permission_policy || null,
      permission_manifest: lock.permission_manifest || null,
      compatibility: lock.compatibility || {},
      publisher: lock.publisher || null,
      security: lock.security || null,
      conflicts: lock.conflicts || [],
      replaces: lock.replaces || [],
      provides: lock.provides || [],
      type_config: lock.type_config || null,
      installed_at: lock.installed_at || item.installed_at,
    };
  } catch {
    return item;
  }
}

async function hydrateRegistry(registry) {
  const packages = [];
  for (const item of registry.packages || []) {
    packages.push(normalizeRecord(await hydrateRecordFromInstallLock(item)));
  }
  return withCompatibility({ ...registry, packages });
}

export function migrateRuntimeRegistry(data) {
  if (!data || typeof data !== 'object') throw new Error('invalid runtime registry');
  if (![1, 2, RUNTIME_REGISTRY_SCHEMA_VERSION].includes(data.schema_version)) {
    throw new Error(`unsupported runtime registry schema: ${data.schema_version}`);
  }

  let source;
  if (data.schema_version === RUNTIME_REGISTRY_SCHEMA_VERSION) source = Array.isArray(data.packages) ? data.packages : data.plugins;
  else source = data.plugins;
  if (!Array.isArray(source)) throw new Error('invalid runtime registry packages');

  const seen = new Set();
  const packages = source.map((item) => {
    const normalized = normalizeRecord(item);
    const key = packageKey(normalized.type, normalized.id);
    if (seen.has(key)) throw new Error(`duplicate runtime package: ${key}`);
    seen.add(key);
    return normalized;
  });

  if (data.schema_version === RUNTIME_REGISTRY_SCHEMA_VERSION && Array.isArray(data.plugins)) {
    for (const plugin of data.plugins) {
      const normalized = normalizeRecord({ ...plugin, type: 'plugin' });
      const canonical = packages.find((item) => packageKey(item.type, item.id) === packageKey('plugin', normalized.id));
      if (!canonical) throw new Error(`runtime registry plugin mirror missing canonical package: ${normalized.id}`);
      if (canonical.version !== normalized.version || canonical.state !== normalized.state) {
        throw new Error(`runtime registry plugin mirror drift: ${normalized.id}`);
      }
    }
  }

  return withCompatibility({
    schema_version: RUNTIME_REGISTRY_SCHEMA_VERSION,
    updated_at: data.updated_at || new Date().toISOString(),
    generation: Number(data.generation) || 0,
    packages,
  });
}

export async function readRuntimeRegistry(file = registryPath()) {
  try {
    return hydrateRegistry(migrateRuntimeRegistry(JSON.parse(await readFile(file, 'utf8'))));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return withCompatibility({ schema_version: RUNTIME_REGISTRY_SCHEMA_VERSION, generation: 0, packages: [] });
    }
    throw error;
  }
}

async function diskGeneration(file) {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    return Number(data.generation) || 0;
  } catch (error) {
    if (error?.code === 'ENOENT') return 0;
    throw error;
  }
}

async function acquireRegistryLock(file, options = {}) {
  const lockFile = registryLockPath(file);
  const timeout = Number(options.timeoutMs) || REGISTRY_LOCK_TIMEOUT_MS;
  const deadline = Date.now() + timeout;
  await mkdir(dirname(lockFile), { recursive: true });

  while (true) {
    try {
      const handle = await open(lockFile, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })}\n`);
      return async () => {
        try { await handle.close(); } finally { await unlink(lockFile).catch(() => {}); }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const info = await stat(lockFile);
        if (Date.now() - info.mtimeMs > REGISTRY_LOCK_STALE_MS) {
          await unlink(lockFile);
          continue;
        }
      } catch (inspectError) {
        if (inspectError?.code === 'ENOENT') continue;
        throw inspectError;
      }
      if (Date.now() >= deadline) {
        const busy = new Error(`runtime registry is busy: ${file}`);
        busy.code = 'DSH_REGISTRY_BUSY';
        throw busy;
      }
      await new Promise((accept) => setTimeout(accept, 50));
    }
  }
}

export async function writeRuntimeRegistry(registry, file = registryPath(), options = {}) {
  const targetFile = resolve(file);
  const release = await acquireRegistryLock(targetFile, options);
  try {
    const currentGeneration = await diskGeneration(targetFile);
    const expectedGeneration = Number(registry.generation);
    if (!options.force && Number.isFinite(expectedGeneration) && expectedGeneration !== currentGeneration) {
      const conflict = new Error(`runtime registry generation conflict: expected ${expectedGeneration}, current ${currentGeneration}`);
      conflict.code = 'DSH_REGISTRY_CONFLICT';
      conflict.expected_generation = expectedGeneration;
      conflict.current_generation = currentGeneration;
      throw conflict;
    }

    const source = Array.isArray(registry.packages) ? registry.packages : registry.plugins || [];
    const seen = new Set();
    const packages = [];
    for (const item of source) {
      const normalized = normalizeRecord(await hydrateRecordFromInstallLock(item));
      const key = packageKey(normalized.type, normalized.id);
      if (seen.has(key)) throw new Error(`duplicate runtime package: ${key}`);
      seen.add(key);
      packages.push(normalized);
    }

    const next = {
      schema_version: RUNTIME_REGISTRY_SCHEMA_VERSION,
      generation: currentGeneration + 1,
      updated_at: new Date().toISOString(),
      packages,
      plugins: packages.filter((item) => item.type === 'plugin'),
    };
    await mkdir(dirname(targetFile), { recursive: true });
    const temp = `${targetFile}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temp, JSON.stringify(next, null, 2) + '\n', 'utf8');
    await rename(temp, targetFile);
    return withCompatibility(next);
  } finally {
    await release();
  }
}

export function getRuntimePackage(registry, type, id, options = {}) {
  const key = packageKey(type, id);
  const item = (registry.packages || registry.plugins || []).find((entry) => packageKey(entry.type || 'plugin', entry.id) === key);
  if (!item || (!options.includeRemoved && item.state === 'removed')) return null;
  return normalizeRecord(item);
}

export function findRuntimePackage(registry, id, options = {}) {
  const normalizedId = safePackageId(id).toLowerCase();
  const matches = (registry.packages || registry.plugins || [])
    .filter((entry) => String(entry.id || '').toLowerCase() === normalizedId)
    .filter((entry) => options.includeRemoved || entry.state !== 'removed')
    .map(normalizeRecord);
  if (options.type) return matches.find((entry) => entry.type === assertPackageType(options.type)) || null;
  if (matches.length > 1) throw new Error(`runtime package id is ambiguous; specify type: ${id}`);
  return matches[0] || null;
}

export function upsertRuntimePackage(registry, item) {
  const next = normalizeRecord(item);
  const key = packageKey(next.type, next.id);
  const packages = (registry.packages || registry.plugins || [])
    .map(normalizeRecord)
    .filter((entry) => packageKey(entry.type, entry.id) !== key);
  return withCompatibility({ ...registry, packages: [...packages, next] });
}

export function markRuntimePackageRemoved(registry, type, id, details = {}) {
  const current = getRuntimePackage(registry, type, id, { includeRemoved: true });
  if (!current) throw new Error(`runtime package is not installed: ${type}:${id}`);
  const removed = recordRuntimeEvent(
    { ...current, state: 'removed', enabled: false, activated: false, restart_required: true, health: null, binding: null },
    'removed',
    details,
  );
  return upsertRuntimePackage(registry, removed);
}

export function packagePath(type, id, root = packageRoot(type)) {
  return join(resolve(root), safePackageId(id));
}

export function getRuntimePlugin(registry, id, options = {}) {
  return getRuntimePackage(registry, 'plugin', id, options);
}

export function upsertRuntimePlugin(registry, item) {
  return upsertRuntimePackage(registry, { ...item, type: 'plugin' });
}

export function markRuntimePluginRemoved(registry, id, details = {}) {
  return markRuntimePackageRemoved(registry, 'plugin', id, details);
}

export function pluginPath(id, root = pluginRoot()) {
  return packagePath('plugin', id, root);
}

export async function removePath(path) {
  await rm(path, { recursive: true, force: true });
}

export async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}