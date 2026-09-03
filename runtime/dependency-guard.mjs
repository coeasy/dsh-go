import { randomUUID } from 'node:crypto';
import { rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { normalizePackageDependency, packageKey } from './package-model.mjs';
import {
  getRuntimePackage,
  markRuntimePackageRemoved,
  packagePath,
  readRuntimeRegistry,
  registryPath,
  updateRuntimeRegistry,
  pathExists,
} from './registry.mjs';
import { withFileLock } from './file-lock.mjs';
import { withPackageOperationLocks } from './package-operation-lock.mjs';

function dependencyKey(dependency) {
  try {
    const normalized = normalizePackageDependency(dependency, 'plugin');
    return packageKey(normalized.type, normalized.id);
  } catch {
    return null;
  }
}

export function findRuntimeDependents(registry, type, id) {
  const key = packageKey(type, id);
  return (registry.packages || [])
    .filter((record) => record.state !== 'removed')
    .filter((record) => packageKey(record.type || 'plugin', record.id) !== key)
    .filter((record) => (record.dependencies || []).some((dependency) => dependencyKey(dependency) === key))
    .map((record) => ({
      id: record.id,
      type: record.type || 'plugin',
      key: packageKey(record.type || 'plugin', record.id),
      version: record.version,
      state: record.state,
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function removalOrder(registry, type, id, stack = [], seen = new Set()) {
  const key = packageKey(type, id);
  if (stack.includes(key)) throw new Error(`runtime dependency cycle while removing: ${[...stack, key].join(' -> ')}`);
  if (seen.has(key)) return [];
  const dependents = findRuntimeDependents(registry, type, id);
  const order = [];
  for (const dependent of dependents) {
    order.push(...removalOrder(registry, dependent.type, dependent.id, [...stack, key], seen));
  }
  seen.add(key);
  order.push({ type, id, key });
  return order;
}

export async function planRuntimeRemoval(type, id, options = {}) {
  const registry = options.registry || await readRuntimeRegistry(options.registryFile);
  const item = getRuntimePackage(registry, type, id);
  if (!item) throw new Error(`runtime package is not installed: ${packageKey(type, id)}`);
  const dependents = findRuntimeDependents(registry, type, id);
  if (dependents.length && !options.cascade) {
    const error = new Error(`cannot remove ${packageKey(type, id)}; required by ${dependents.map((item) => item.key).join(', ')} (use --cascade to remove dependents first)`);
    error.code = 'DSH_PACKAGE_IN_USE';
    error.dependents = dependents;
    throw error;
  }
  const order = options.cascade ? removalOrder(registry, type, id) : [{ type, id, key: packageKey(type, id) }];
  return { root: packageKey(type, id), cascade: options.cascade === true, dependents, order };
}

export async function removeRuntimePackageSafe(type, id, options = {}) {
  const registryFile = resolve(options.registryFile || registryPath());
  if (options.dryRun) {
    const registry = await readRuntimeRegistry(registryFile);
    const plan = await planRuntimeRemoval(type, id, { ...options, registry });
    return { ...plan, dry_run: true, restart_required: false };
  }

  const lockFile = `${registryFile}.remove.lock`;
  return withFileLock(lockFile, async () => {
    let registry = await readRuntimeRegistry(registryFile);
    const plan = await planRuntimeRemoval(type, id, { ...options, registry });
    return withPackageOperationLocks(plan.order, async () => {
      const latest = await readRuntimeRegistry(registryFile);
      if (latest.generation !== registry.generation) {
        const conflict = new Error(`runtime registry changed while preparing removal: expected generation ${registry.generation}, current ${latest.generation}`);
        conflict.code = 'DSH_REGISTRY_CONFLICT';
        conflict.expected_generation = registry.generation;
        conflict.current_generation = latest.generation;
        throw conflict;
      }
      registry = latest;
      const transactionId = randomUUID();
      const moves = [];
      const removed = [];
      let registryCommitted = false;
      try {
        for (const candidate of plan.order) {
          const item = getRuntimePackage(registry, candidate.type, candidate.id);
          if (!item) throw new Error(`runtime package disappeared during removal: ${candidate.key}`);
          const target = item.path || packagePath(candidate.type, candidate.id);
          const targetBackup = `${target}.remove-${transactionId}`;
          const rollbackBackup = `${target}.backup.remove-${transactionId}`;
          const move = { type: candidate.type, id: candidate.id, target, targetBackup, rollback: `${target}.backup`, rollbackBackup, movedTarget: false, movedRollback: false };
          moves.push(move);
          if (await pathExists(target)) {
            await rename(target, targetBackup);
            move.movedTarget = true;
          }
          if (await pathExists(move.rollback)) {
            await rename(move.rollback, rollbackBackup);
            move.movedRollback = true;
          }
          registry = markRuntimePackageRemoved(registry, candidate.type, candidate.id, {
            path: target,
            cascade_root: plan.root,
          });
          removed.push({ ...candidate, path: target });
        }
        await updateRuntimeRegistry((latestRegistry) => {
          let next = latestRegistry;
          for (const candidate of plan.order) {
            if (!getRuntimePackage(next, candidate.type, candidate.id, { includeRemoved: true })) {
              throw new Error(`runtime package disappeared during removal: ${candidate.key}`);
            }
            if (getRuntimePackage(next, candidate.type, candidate.id)?.state === 'removed') continue;
            const move = moves.find((entry) => entry.type === candidate.type && entry.id === candidate.id);
            next = markRuntimePackageRemoved(next, candidate.type, candidate.id, {
              path: move?.target,
              cascade_root: plan.root,
            });
          }
          return next;
        }, registryFile);
        registryCommitted = true;
        await Promise.all(moves.flatMap((move) => [
          rm(move.targetBackup, { recursive: true, force: true }),
          rm(move.rollbackBackup, { recursive: true, force: true }),
        ].map((promise) => promise.catch(() => {}))));
        return { ...plan, removed, restart_required: true };
      } catch (error) {
        let rollbackCompleted = false;
        if (!registryCommitted) {
        try {
          for (const move of [...moves].reverse()) {
            if (move.movedTarget) {
              await rm(move.target, { recursive: true, force: true });
              if (await pathExists(move.targetBackup)) await rename(move.targetBackup, move.target);
            }
            if (move.movedRollback) {
              await rm(move.rollback, { recursive: true, force: true });
              if (await pathExists(move.rollbackBackup)) await rename(move.rollbackBackup, move.rollback);
            }
          }
          rollbackCompleted = true;
        } catch (rollbackError) {
          error.rollback_error = rollbackError.message;
          error.recovery_required = true;
        }
        } else {
          error.state_preserved = true;
        }
        if (registryCommitted || rollbackCompleted) {
          for (const move of moves) {
            await rm(move.targetBackup, { recursive: true, force: true }).catch(() => {});
            await rm(move.rollbackBackup, { recursive: true, force: true }).catch(() => {});
          }
        }
        throw error;
      }
    }, { ...options, registryFile });
  }, { timeoutMs: options.operationLockTimeoutMs, staleMs: options.operationLockStaleMs });
}
