import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { defaultPluginHome } from './installer.mjs';
import { activatePlugin } from './platform.mjs';
import {
  getRuntimePlugin,
  readRuntimeRegistry,
  upsertRuntimePlugin,
  writeRuntimeRegistry,
} from './registry.mjs';
import { readInstallLock, verifyInstalledCommit } from './verifier.mjs';

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function loadInstalledPlugin(id, options = {}) {
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) throw new Error(`unsafe plugin id: ${id}`);
  const runtimeRegistry = await readRuntimeRegistry(options.registryFile);
  const runtimeRecord = getRuntimePlugin(runtimeRegistry, id, { includeRemoved: true });
  if (runtimeRecord?.state === 'removed') throw new Error(`plugin is removed: ${id}`);
  if (runtimeRecord?.enabled === false || runtimeRecord?.state === 'disabled') throw new Error(`plugin is disabled: ${id}`);

  const root = resolve(options.root || defaultPluginHome());
  const target = options.root
    ? join(root, id)
    : runtimeRecord?.path
      ? resolve(runtimeRecord.path)
      : join(root, id);
  const lock = await readInstallLock(target);
  if (lock.id !== id) throw new Error(`install lock id mismatch: expected ${id}, got ${lock.id}`);
  if (options.version && lock.version !== options.version) throw new Error(`installed version mismatch: expected ${options.version}, got ${lock.version}`);
  await verifyInstalledCommit(target, lock.source.commit);

  let manifest = null;
  let manifestFile = null;
  for (const file of ['dsh-plugin.json', 'package.json']) {
    const path = join(target, file);
    if (await exists(path)) {
      manifest = JSON.parse(await readFile(path, 'utf8'));
      manifestFile = file;
      break;
    }
  }

  let activatedRecord = runtimeRecord;
  if (runtimeRecord) {
    activatedRecord = activatePlugin(runtimeRecord);
    await writeRuntimeRegistry(
      upsertRuntimePlugin(runtimeRegistry, activatedRecord),
      options.registryFile,
    );
  }

  return {
    id: lock.id,
    version: lock.version,
    channel: lock.channel || activatedRecord?.channel || 'stable',
    target,
    commit: lock.source.commit,
    runtime: lock.runtime,
    capabilities: lock.capabilities || [],
    manifest_file: manifestFile,
    manifest,
    activation: 'active',
    restart_required: activatedRecord?.restart_required ?? false,
    message: 'Plugin source is installed, verified, and activated by the client startup loader.',
  };
}
