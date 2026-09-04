import { loadInstalledPackage } from './loader.mjs';
import { recordRuntimeEvent } from './lifecycle.mjs';
import { packageKey } from '../packages/protocol-core/index.mjs';
import { packageActivationState } from './package-status.mjs';
import { recoverPackageTransactions } from './transaction.mjs';
import { recoverEnvironmentTransactions } from './environment-lock.mjs';
import {
  getRuntimePackage,
  readRuntimeRegistry,
  updateRuntimeRegistry,
  upsertRuntimePackage,
} from './registry.mjs';
import { withPackageOperationLock } from './package-operation-lock.mjs';

function isActivationCandidate(record) {
  if (!record || record.state === 'removed' || record.state === 'disabled' || record.enabled === false) return false;
  if (record.state === 'failed' && !record.restart_required) return false;
  return record.state === 'installed' || record.state === 'pending-restart' || record.restart_required === true || record.activated !== true;
}

async function markActivationFailed(type, id, error, registryFile) {
  return withPackageOperationLock(type, id, async () => {
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
    await updateRuntimeRegistry((latest) => upsertRuntimePackage(latest, failed), registryFile);
  }, { registryFile });
}

export async function activatePendingPackages(options = {}) {
  const registryFile = options.registryFile;
  const [packageRecovery, environmentRecovery] = await Promise.all([
    recoverPackageTransactions({ registryFile }),
    recoverEnvironmentTransactions({ registryFile }),
  ]);
  const registry = await readRuntimeRegistry(registryFile);
  const packages = registry.packages;
  const candidates = packages.filter(isActivationCandidate);
  const activated = [];
  const failed = [];

  for (const record of candidates) {
    const key = packageKey(record.type, record.id);
    try {
      const loaded = await loadInstalledPackage(record.type, record.id, { registryFile, version: record.version });
      activated.push({
        id: loaded.id,
        type: loaded.type,
        key,
        version: loaded.version,
        commit: loaded.commit,
        activation_state: 'active',
        binding: loaded.binding,
        restart_required: loaded.restart_required,
      });
    } catch (error) {
      await markActivationFailed(record.type, record.id, error, registryFile);
      failed.push({ type: record.type, id: record.id, key, activation_state: 'failed', error: error.message });
    }
  }

  return {
    recovered_transactions: [...packageRecovery.recovered, ...environmentRecovery.recovered],
    scanned: packages.length,
    pending: candidates.length,
    pending_packages: candidates.map((record) => ({
      id: record.id,
      type: record.type,
      key: packageKey(record.type, record.id),
      activation_state: packageActivationState(record),
    })),
    activated,
    failed,
    healthy: failed.length === 0
      && packageRecovery.recovered.every((item) => !item.error)
      && environmentRecovery.recovered.every((item) => !item.error && item.state !== 'conflict'),
    restart_required: failed.length > 0,
  };
}
