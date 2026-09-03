import { randomUUID } from 'node:crypto';
import { access, rename, rm } from 'node:fs/promises';
import { readInstallLock } from './verifier.mjs';
import { withPackageOperationLock } from './package-operation-lock.mjs';

async function rollbackInstalledPathUnlocked(target) {
  const backup = `${target}.backup`;
  await access(backup);
  const failed = `${target}.failed-${process.pid}-${Date.now()}-${randomUUID()}`;
  let targetMoved = false;
  let backupMoved = false;
  try {
    await rename(target, failed);
    targetMoved = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  try {
    await rename(backup, target);
    backupMoved = true;
    const lock = await readInstallLock(target);
    if (targetMoved) await rm(failed, { recursive: true, force: true });
    return { target, backup, lock };
  } catch (error) {
    try {
      if (backupMoved) {
        if (targetMoved) {
          await rm(target, { recursive: true, force: true });
          await rename(failed, target);
        } else {
          await rename(target, backup);
        }
      } else if (targetMoved) {
        await rename(failed, target);
      }
    } catch {
      // Preserve the original rollback error; recovery is best effort.
    }
    throw error;
  }
}

export function rollbackInstalledPath(target, options = {}) {
  if (options.operationLockHeld || !options.type || !options.id) return rollbackInstalledPathUnlocked(target);
  return withPackageOperationLock(options.type, options.id, () => rollbackInstalledPathUnlocked(target), options);
}
