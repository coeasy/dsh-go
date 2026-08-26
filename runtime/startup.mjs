import { loadInstalledPackage } from './loader.mjs';
import { recordRuntimeEvent } from './lifecycle.mjs';
import { packageKey } from './package-model.mjs';
import { recoverPackageTransactions } from './transaction.mjs';
import {
  getRuntimePackage,
  readRuntimeRegistry,
  upsertRuntimePackage,
  writeRuntimeRegistry,
} from './registry.mjs';

function isActivationCandidate(record) {
  if (!record || record.state === 'removed' || record.state === 'disabled' || record.enabled === false) return false;
  if (record.state === 'failed' && !record.restart_required) return false;
  return record.state === 'installed' || record.restart_required === true || record.activated !== true;
}

async function markActivationFailed(type, id, error, registryFile) {
  const registry = await readRuntimeRegistry(registryFile);
  const current = getRuntimePackage(registry, type, id, { includeRemoved: true });
  if (!current) return;
  const failed = recordRuntimeEvent({
    ...current,
    state: 'failed',
    activated: false,
    binding: null,
    restart_required: true,
    health: {
      status: 'failed',
      phase: 'startup-activation',
      error: error.message,
      checked_at: new Date().toISOString(),
    },
  }, 'activation-failed', { error: error.message });
  await writeRuntimeRegistry(upsertRuntimePackage(registry, failed), registryFile);
}

export async function activatePendingPackages(options = {}) {
  const registryFile = options.registryFile;
  const recovery = await recoverPackageTransactions({ registryFile });
  const registry = await readRuntimeRegistry(registryFile);
  const packages = registry.packages || [];
  const candidates = packages.filter(isActivationCandidate);
  const activated = [];
  const failed = [];

  for (const record of candidates) {
    try {
      const loaded = await loadInstalledPackage(record.type || 'plugin', record.id, {
        registryFile,
        version: record.version,
      });
      activated.push({
        id: loaded.id,
        type: loaded.type,
        key: packageKey(loaded.type, loaded.id),
        version: loaded.version,
        commit: loaded.commit,
        activation: loaded.activation,
        binding: loaded.binding,
        restart_required: loaded.restart_required,
      });
    } catch (error) {
      await markActivationFailed(record.type || 'plugin', record.id, error, registryFile);
      failed.push({ type: record.type || 'plugin', id: record.id, key: packageKey(record.type || 'plugin', record.id), error: error.message });
    }
  }

  return {
    recovered_transactions: recovery.recovered,
    scanned: packages.length,
    pending: candidates.length,
    activated,
    failed,
    healthy: failed.length === 0 && recovery.recovered.every((item) => !item.error),
    restart_required: failed.length > 0,
  };
}

export async function activatePendingPlugins(options = {}) {
  return activatePendingPackages(options);
}
