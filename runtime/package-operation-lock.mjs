import { resolve } from 'node:path';
import { packageKey } from './package-model.mjs';
import { registryPath } from './registry.mjs';
import { withFileLock } from './file-lock.mjs';

function lockPath(type, id, registryFile) {
  const key = packageKey(type, id).replace(':', '-');
  return `${resolve(registryFile || registryPath())}.${key}.operation.lock`;
}

export function withPackageOperationLock(type, id, task, options = {}) {
  if (options.operationLockHeld) return task();
  return withFileLock(lockPath(type, id, options.registryFile), task, {
    timeoutMs: options.operationLockTimeoutMs,
    staleMs: options.operationLockStaleMs,
  });
}

export function withPackageOperationLocks(packages, task, options = {}) {
  const unique = [...new Map((packages || []).map((item) => {
    const key = packageKey(item.type, item.id);
    return [key, { type: item.type, id: item.id, key }];
  })).values()].sort((left, right) => left.key.localeCompare(right.key));

  async function acquire(index) {
    if (index >= unique.length) return task();
    const item = unique[index];
    return withPackageOperationLock(item.type, item.id, () => acquire(index + 1), options);
  }

  return acquire(0);
}
