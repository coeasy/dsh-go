import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createRuntimeRecord, recordRuntimeEvent } from './lifecycle.mjs';

export const RUNTIME_REGISTRY_SCHEMA_VERSION = 2;

export function runtimeRoot() {
  return resolve(process.env.DSH_RUNTIME_HOME || join(homedir(), '.dsh'));
}

export function registryPath() {
  return resolve(process.env.DSH_REGISTRY || join(runtimeRoot(), 'registry', 'runtime.json'));
}

export function pluginRoot() {
  return resolve(process.env.DSH_PLUGIN_HOME || join(runtimeRoot(), 'plugins'));
}

function safeId(id) {
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) throw new Error(`unsafe plugin id: ${id}`);
  return id;
}

function normalizeRecord(item) {
  const base = createRuntimeRecord(item.id, item.version || '0.1.0');
  const state = item.state || 'installed';
  return {
    ...base,
    ...item,
    state,
    channel: item.channel || 'stable',
    enabled: item.enabled ?? (state !== 'disabled' && state !== 'removed'),
    activated: item.activated ?? false,
    restart_required: item.restart_required ?? item.restartRequired ?? false,
    health: item.health || null,
    rollback: item.rollback || null,
    dependencies: item.dependencies || [],
    history: Array.isArray(item.history) ? item.history.slice(-100) : base.history,
  };
}

export function migrateRuntimeRegistry(data) {
  if (!data || !Array.isArray(data.plugins)) throw new Error('invalid runtime registry');
  if (![1, RUNTIME_REGISTRY_SCHEMA_VERSION].includes(data.schema_version)) {
    throw new Error(`unsupported runtime registry schema: ${data.schema_version}`);
  }
  return {
    schema_version: RUNTIME_REGISTRY_SCHEMA_VERSION,
    updated_at: data.updated_at || new Date().toISOString(),
    generation: Number(data.generation) || 0,
    plugins: data.plugins.map(normalizeRecord),
  };
}

export async function readRuntimeRegistry(file = registryPath()) {
  try {
    return migrateRuntimeRegistry(JSON.parse(await readFile(file, 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { schema_version: RUNTIME_REGISTRY_SCHEMA_VERSION, generation: 0, plugins: [] };
    }
    throw error;
  }
}

export async function writeRuntimeRegistry(registry, file = registryPath()) {
  const seen = new Set();
  const plugins = [];
  for (const item of registry.plugins || []) {
    if (!item?.id || seen.has(item.id)) throw new Error(`duplicate or missing runtime plugin id: ${item?.id || ''}`);
    seen.add(item.id);
    plugins.push(normalizeRecord(item));
  }
  const next = {
    schema_version: RUNTIME_REGISTRY_SCHEMA_VERSION,
    generation: (Number(registry.generation) || 0) + 1,
    updated_at: new Date().toISOString(),
    plugins,
  };
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  await rename(temp, file);
  return next;
}

export function getRuntimePlugin(registry, id, options = {}) {
  const item = (registry.plugins || []).find((entry) => entry.id === id);
  if (!item || (!options.includeRemoved && item.state === 'removed')) return null;
  return item;
}

export function upsertRuntimePlugin(registry, item) {
  const next = normalizeRecord(item);
  const plugins = (registry.plugins || []).filter((entry) => entry.id !== next.id);
  return { ...registry, plugins: [...plugins, next] };
}

export function markRuntimePluginRemoved(registry, id, details = {}) {
  const current = getRuntimePlugin(registry, id, { includeRemoved: true });
  if (!current) throw new Error(`plugin is not installed: ${id}`);
  const removed = recordRuntimeEvent(
    { ...current, state: 'removed', enabled: false, activated: false, restart_required: true, health: null },
    'removed',
    details,
  );
  return upsertRuntimePlugin(registry, removed);
}

export function pluginPath(id, root = pluginRoot()) {
  return join(resolve(root), safeId(id));
}

export async function removePath(path) {
  const { rm } = await import('node:fs/promises');
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
