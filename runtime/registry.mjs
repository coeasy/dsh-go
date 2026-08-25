import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

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

export async function readRuntimeRegistry(file = registryPath()) {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (!data || data.schema_version !== 1 || !Array.isArray(data.plugins)) throw new Error('invalid runtime registry');
    return data;
  } catch (error) {
    if (error?.code === 'ENOENT') return { schema_version: 1, plugins: [] };
    throw error;
  }
}

export async function writeRuntimeRegistry(registry, file = registryPath()) {
  const next = { schema_version: 1, updated_at: new Date().toISOString(), plugins: registry.plugins };
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, JSON.stringify(next, null, 2) + '\\n', 'utf8');
  await rename(temp, file);
  return next;
}

export function pluginPath(id, root = pluginRoot()) {
  return join(resolve(root), safeId(id));
}

export async function removePath(path) {
  const { rm } = await import('node:fs/promises');
  await rm(path, { recursive: true, force: true });
}

export async function pathExists(path) {
  try { await access(path); return true; } catch { return false; }
}
