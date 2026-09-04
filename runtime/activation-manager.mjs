import { randomUUID } from 'node:crypto';
import { rename, rm } from 'node:fs/promises';
import { packageKey } from '../packages/protocol-core/index.mjs';
import { recordRuntimeEvent } from './lifecycle.mjs';
import { prepareInstalledPackage } from './loader.mjs';
import { packageActivationState } from './package-status.mjs';
import { recoverPackageTransactions } from './transaction.mjs';
import { recoverEnvironmentTransactions } from './environment-lock.mjs';
import { readInstallLock } from './verifier.mjs';
import {
  getRuntimePackage,
  pathExists,
  readRuntimeRegistry,
  upsertRuntimePackage,
  writeRuntimeRegistry,
} from './registry.mjs';
import { withPackageOperationLocks } from './package-operation-lock.mjs';

const DEFAULT_FAILURE_LIMIT = 2;

function isActivationCandidate(record) {
  if (!record || record.state === 'removed' || record.state === 'disabled' || record.enabled === false) return false;
  if (record.state === 'failed' && record.restart_required === false) return false;
  return record.state === 'installed' || record.state === 'pending-restart' || record.restart_required === true || record.activated !== true;
}

function fingerprint(record) {
  return `${record.version}:${record.content_digest || record.content?.digest || record.commit || record.source?.commit || 'unknown'}`;
}

function failedRecord(record, error, limit) {
  const currentFingerprint = fingerprint(record);
  const previous = record.activation || {};
  const previousAttempts = previous.failure_fingerprint === currentFingerprint ? Number(previous.failed_attempts || 0) : 0;
  const failedAttempts = previousAttempts + 1;
  const terminal = failedAttempts >= limit;
  return recordRuntimeEvent({
    ...record,
    state: 'failed',
    activated: false,
    binding: null,
    restart_required: !terminal,
    health: {
      status: 'failed',
      phase: 'startup-activation',
      error: error.message,
      checked_at: new Date().toISOString(),
    },
    activation: {
      ...previous,
      attempts: Number(previous.attempts || 0) + 1,
      failed_attempts: failedAttempts,
      failure_fingerprint: currentFingerprint,
      last_attempt_at: new Date().toISOString(),
      terminal,
    },
  }, terminal ? 'activation-failed-terminal' : 'activation-failed', {
    error: error.message,
    failure_fingerprint: currentFingerprint,
    failed_attempts: failedAttempts,
  });
}

function recordFromBackup(current, lock, target) {
  return {
    ...current,
    id: lock.id,
    type: lock.type,
    version: lock.version,
    channel: lock.channel || 'stable',
    path: target,
    source: lock.source,
    commit: lock.source?.commit,
    runtime: lock.runtime || {},
    entrypoints: lock.entrypoints || {},
    capabilities: lock.capabilities || [],
    dependencies: lock.dependencies || [],
    permissions: lock.permissions || [],
    compatibility: lock.compatibility || {},
    publisher: lock.publisher || null,
    security: lock.security || null,
    artifact: lock.artifact || null,
    content_digest: lock.content_digest || lock.content?.digest || null,
    content: lock.content || null,
    trust_snapshot: lock.trust_snapshot || null,
    policy_snapshot: lock.policy_snapshot || null,
    supply_chain_verification: lock.supply_chain_verification || null,
    adapter: lock.adapter || null,
    state: 'pending-restart',
    enabled: current.enabled !== false,
    activated: false,
    restart_required: true,
    binding: null,
  };
}

async function tryRestoreLastKnownGood(state, current, options = {}) {
  const backup = current.rollback?.backup_path;
  const target = current.path;
  if (!backup || !target || !await pathExists(backup)) return null;
  const failedPath = `${target}.failed-activation-${randomUUID()}`;
  let movedCandidate = false;
  let movedBackup = false;
  try {
    if (await pathExists(target)) { await rename(target, failedPath); movedCandidate = true; }
    await rename(backup, target);
    movedBackup = true;
    const lock = await readInstallLock(target);
    const restored = recordRuntimeEvent(recordFromBackup(current, lock, target), 'last-known-good-restored', {
      failed_version: current.version,
      restored_version: lock.version,
    });
    const synthetic = upsertRuntimePackage(state, restored);
    const prepared = await prepareInstalledPackage(restored.type, restored.id, {
      ...options,
      runtimeRegistry: synthetic,
      version: restored.version,
    });
    await rm(failedPath, { recursive: true, force: true }).catch(() => {});
    return {
      state: upsertRuntimePackage(state, recordRuntimeEvent({
        ...prepared.activated_record,
        rollback: null,
        activation: {
          ...(prepared.activated_record.activation || {}),
          recovered_from_failed_version: current.version,
          last_known_good: true,
        },
      }, 'last-known-good-activated', { failed_version: current.version })),
      result: {
        key: packageKey(restored.type, restored.id),
        version: restored.version,
        recovered_from: current.version,
        action: 'last-known-good-restored',
      },
    };
  } catch (error) {
    if (movedBackup && await pathExists(target)) await rename(target, backup).catch(() => {});
    if (movedCandidate && await pathExists(failedPath)) await rename(failedPath, target).catch(() => {});
    return { error };
  }
}

export async function activateRuntimeGeneration(options = {}) {
  const registryFile = options.registryFile;
  const [packageRecovery, environmentRecovery] = await Promise.all([
    recoverPackageTransactions({ registryFile }),
    recoverEnvironmentTransactions({ registryFile }),
  ]);
  const initial = await readRuntimeRegistry(registryFile);
  const candidates = initial.packages.filter(isActivationCandidate);
  const failureLimit = Math.max(1, Number(options.failureLimit || process.env.DSH_ACTIVATION_FAILURE_LIMIT || DEFAULT_FAILURE_LIMIT));

  return withPackageOperationLocks(candidates, async () => {
    const current = await readRuntimeRegistry(registryFile);
    if (current.generation !== initial.generation) {
      const error = new Error(`runtime state changed before activation: expected ${initial.generation}, current ${current.generation}`);
      error.code = 'DSH_TRANSACTION_CONFLICT';
      throw error;
    }
    let next = {
      ...current,
      activation: {
        ...(current.activation || {}),
        candidate_generation: current.generation,
        last_activation_at: new Date().toISOString(),
      },
    };
    const activated = [];
    const failed = [];
    const recovered = [];

    for (const candidate of candidates) {
      const latest = getRuntimePackage(next, candidate.type, candidate.id, { includeRemoved: true }) || candidate;
      try {
        const prepared = await prepareInstalledPackage(latest.type, latest.id, {
          ...options,
          runtimeRegistry: next,
          version: latest.version,
        });
        next = upsertRuntimePackage(next, prepared.activated_record);
        activated.push({
          id: prepared.id,
          type: prepared.type,
          key: prepared.key,
          version: prepared.version,
          commit: prepared.commit,
          adapter: prepared.adapter,
          activation_state: 'active',
          restart_required: prepared.restart_required,
        });
      } catch (error) {
        const lkg = await tryRestoreLastKnownGood(next, latest, options);
        if (lkg?.state) {
          next = lkg.state;
          recovered.push(lkg.result);
          continue;
        }
        const failedState = failedRecord(latest, error, failureLimit);
        next = upsertRuntimePackage(next, failedState);
        failed.push({
          type: latest.type,
          id: latest.id,
          key: packageKey(latest.type, latest.id),
          version: latest.version,
          activation_state: 'failed',
          terminal: failedState.restart_required === false,
          error: error.message,
          recovery_error: lkg?.error?.message || null,
        });
      }
    }

    const healthy = failed.length === 0
      && packageRecovery.recovered.every((item) => !item.error)
      && environmentRecovery.recovered.every((item) => !item.error && item.state !== 'conflict');
    next.activation = {
      ...(next.activation || {}),
      candidate_generation: healthy ? null : current.generation,
      active_generation: healthy ? current.generation : (current.activation?.active_generation ?? current.generation),
      last_known_good_generation: healthy ? current.generation : (current.activation?.last_known_good_generation ?? current.generation),
      last_activation_at: new Date().toISOString(),
    };

    const changed = candidates.length > 0 || packageRecovery.recovered.length > 0 || environmentRecovery.recovered.length > 0;
    const committed = changed ? await writeRuntimeRegistry(next, registryFile) : current;
    return {
      recovered_transactions: [...packageRecovery.recovered, ...environmentRecovery.recovered],
      scanned: current.packages.length,
      pending: candidates.length,
      pending_packages: candidates.map((record) => ({ id: record.id, type: record.type, key: packageKey(record.type, record.id), activation_state: packageActivationState(record) })),
      activated,
      recovered,
      failed,
      generation: committed.generation,
      activation: committed.activation,
      healthy,
      restart_required: failed.some((item) => !item.terminal),
    };
  }, { ...options, registryFile });
}

export const activatePendingPackages = activateRuntimeGeneration;
