import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { defaultPluginHome } from './installer.mjs';
import { readInstallLock, verifyInstalledCommit } from './verifier.mjs';

async function exists(path) { try { await access(path); return true; } catch { return false; } }

export async function loadInstalledPlugin(id, options = {}) {
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) throw new Error(`unsafe plugin id: ${id}`);
  const root = resolve(options.root || defaultPluginHome());
  const target = join(root, id);
  const lock = await readInstallLock(target);
  if (lock.id !== id) throw new Error(`install lock id mismatch: expected ${id}, got ${lock.id}`);
  if (options.version && lock.version !== options.version) throw new Error(`installed version mismatch: expected ${options.version}, got ${lock.version}`);
  await verifyInstalledCommit(target, lock.source.commit);

  let manifest = null;
  let manifestFile = null;
  for (const file of ['dsh-plugin.json', 'package.json']) {
    const path = join(target, file);
    if (await exists(path)) { manifest = JSON.parse(await readFile(path, 'utf8')); manifestFile = file; break; }
  }
  return {
    id: lock.id,
    version: lock.version,
    target,
    commit: lock.source.commit,
    runtime: lock.runtime,
    capabilities: lock.capabilities || [],
    manifest_file: manifestFile,
    manifest,
    activation: 'restart-required',
    message: 'Plugin source is installed and verified. Restart the client to activate it.',
  };
}
