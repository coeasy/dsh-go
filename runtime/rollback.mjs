import { access, rename, rm } from 'node:fs/promises';
import { readInstallLock } from './verifier.mjs';

export async function rollbackInstalledPath(target) {
  const backup = `${target}.backup`;
  await access(backup);
  const failed = `${target}.failed-${Date.now()}`;
  await rename(target, failed);
  try {
    await rename(backup, target);
    const lock = await readInstallLock(target);
    await rm(failed, { recursive: true, force: true });
    return { target, backup, lock };
  } catch (error) {
    try {
      await rename(failed, target);
    } catch {
      // Preserve the original rollback error; recovery is best effort.
    }
    throw error;
  }
}
