import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const ALLOWED_LOCAL_FILES = new Set(['.dsh-install.json']);

async function gitText(directory, args) {
  const { stdout } = await exec('git', ['-C', directory, ...args], { windowsHide: true, encoding: 'utf8' });
  return String(stdout || '').trim();
}

async function gitPaths(directory, args) {
  const { stdout } = await exec('git', ['-C', directory, ...args], { windowsHide: true, encoding: null, maxBuffer: 16 * 1024 * 1024 });
  return Buffer.from(stdout || []).toString('utf8').split('\0').filter(Boolean).map((value) => value.replaceAll('\\', '/'));
}

function disallowed(paths) {
  return paths.filter((path) => !ALLOWED_LOCAL_FILES.has(path));
}

export async function verifyOfflineGitIdentity(directory, expectedCommit) {
  let head;
  try {
    head = (await gitText(directory, ['rev-parse', 'HEAD'])).toLowerCase();
  } catch (cause) {
    const error = new Error(`offline package Git metadata is invalid: ${cause?.message || cause}`);
    error.code = 'DSH_INTEGRITY_MISMATCH';
    throw error;
  }
  const expected = String(expectedCommit || '').toLowerCase();
  if (!expected || head !== expected) {
    const error = new Error(`offline package commit mismatch: expected ${expected || '<empty>'}, got ${head || '<empty>'}`);
    error.code = 'DSH_INTEGRITY_MISMATCH';
    throw error;
  }

  await gitText(directory, ['cat-file', '-e', 'HEAD^{commit}']);
  const changed = disallowed(await gitPaths(directory, ['diff', '--name-only', '-z', 'HEAD', '--']));
  const untracked = disallowed(await gitPaths(directory, ['ls-files', '-z', '--others', '--exclude-standard']));
  const ignored = disallowed(await gitPaths(directory, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard']));
  if (changed.length || untracked.length || ignored.length) {
    const error = new Error(`offline package worktree does not match locked commit: changed=${changed.join(',') || '-'} untracked=${untracked.join(',') || '-'} ignored=${ignored.join(',') || '-'}`);
    error.code = 'DSH_INTEGRITY_MISMATCH';
    error.details = { changed, untracked, ignored };
    throw error;
  }
  return { ok: true, commit: head, changed: [], untracked: [], ignored: [] };
}
