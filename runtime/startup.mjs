import { loadInstalledPlugin } from './loader.mjs';
import { recordRuntimeEvent } from './lifecycle.mjs';
import {
  getRuntimePlugin,
  readRuntimeRegistry,
  upsertRuntimePlugin,
  writeRuntimeRegistry,
} from './registry.mjs';

function isActivationCandidate(record) {
  if (!record || record.state === 'removed' || record.state === 'disabled' || record.enabled === false) return false;
  if (record.state === 'failed' && !record.restart_required) return false;
  return record.state === 'installed' || record.restart_required === true || record.activated !== true;
}

async function markActivationFailed(id, error, registryFile) {
  const registry = await readRuntimeRegistry(registryFile);
  const current = getRuntimePlugin(registry, id, { includeRemoved: true });
  if (!current) return;
  const failed = recordRuntimeEvent({
    ...current,
    state: 'failed',
    activated: false,
    restart_required: true,
    health: {
      status: 'failed',
      phase: 'startup-activation',
      error: error.message,
      checked_at: new Date().toISOString(),
    },
  }, 'activation-failed', { error: error.message });
  await writeRuntimeRegistry(upsertRuntimePlugin(registry, failed), registryFile);
}

export async function activatePendingPlugins(options = {}) {
  const registryFile = options.registryFile;
  const registry = await readRuntimeRegistry(registryFile);
  const candidates = registry.plugins.filter(isActivationCandidate);
  const activated = [];
  const failed = [];

  for (const record of candidates) {
    try {
      const loaded = await loadInstalledPlugin(record.id, {
        registryFile,
        version: record.version,
      });
      activated.push({
        id: loaded.id,
        version: loaded.version,
        commit: loaded.commit,
        activation: loaded.activation,
        restart_required: loaded.restart_required,
      });
    } catch (error) {
      await markActivationFailed(record.id, error, registryFile);
      failed.push({ id: record.id, error: error.message });
    }
  }

  return {
    scanned: registry.plugins.length,
    pending: candidates.length,
    activated,
    failed,
    healthy: failed.length === 0,
    restart_required: failed.length > 0,
  };
}
