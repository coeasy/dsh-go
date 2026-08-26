import { mkdir, open, stat, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_STALE_MS = 30_000;
const DEFAULT_RETRY_MS = 25;
const WINDOWS_CONTENTION_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

function sleep(ms) {
  return new Promise((accept) => setTimeout(accept, ms));
}

function busyError(lockFile, causeCode) {
  const busy = new Error(`state file is busy: ${lockFile}`);
  busy.code = 'DSH_STATE_BUSY';
  busy.lock_file = lockFile;
  busy.cause_code = causeCode || null;
  return busy;
}

function transientWindowsContention(error) {
  return process.platform === 'win32' && WINDOWS_CONTENTION_CODES.has(error?.code);
}

async function inspectExistingLock(lockFile, staleMs, originalError) {
  try {
    const info = await stat(lockFile);
    if (Date.now() - info.mtimeMs <= staleMs) return 'busy';
    try {
      await unlink(lockFile);
      return 'retry';
    } catch (unlinkError) {
      if (unlinkError?.code === 'ENOENT' || transientWindowsContention(unlinkError)) return 'retry';
      throw unlinkError;
    }
  } catch (inspectError) {
    if (inspectError?.code === 'ENOENT') {
      if (originalError?.code === 'EEXIST' || transientWindowsContention(originalError)) return 'retry';
      throw originalError;
    }
    if (transientWindowsContention(inspectError)) return 'busy';
    throw inspectError;
  }
}

export async function acquireFileLock(file, options = {}) {
  const lockFile = resolve(file);
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const staleMs = Math.max(timeoutMs, Number(options.staleMs) || DEFAULT_STALE_MS);
  const retryMs = Math.max(1, Number(options.retryMs) || DEFAULT_RETRY_MS);
  const deadline = Date.now() + timeoutMs;
  await mkdir(dirname(lockFile), { recursive: true });

  while (true) {
    try {
      const handle = await open(lockFile, 'wx', 0o600);
      try {
        await handle.writeFile(`${JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })}\n`, 'utf8');
      } catch (error) {
        await handle.close().catch(() => {});
        await unlink(lockFile).catch(() => {});
        throw error;
      }
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try { await handle.close(); } finally { await unlink(lockFile).catch(() => {}); }
      };
    } catch (error) {
      const contention = error?.code === 'EEXIST' || transientWindowsContention(error);
      if (!contention) throw error;

      const state = await inspectExistingLock(lockFile, staleMs, error);
      if (Date.now() >= deadline) throw busyError(lockFile, error?.code);
      if (state === 'busy' || state === 'retry') {
        await sleep(retryMs);
        continue;
      }
    }
  }
}

export async function withFileLock(file, task, options = {}) {
  const release = await acquireFileLock(file, options);
  try {
    return await task();
  } finally {
    await release();
  }
}
