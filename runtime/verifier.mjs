import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { artifactIntegrity } from '../scripts/checksum.mjs';

const exec = promisify(execFile);
const COMMIT_RE = /^[0-9a-f]{40}$/i;

export function verifyResolvedPlugin(plugin) {
  const errors = [];
  if (!plugin?.id) errors.push('missing id');
  if (plugin?.version !== '0.1.0') errors.push('version must be 0.1.0');
  if (!plugin?.repo || !plugin.repo.includes('/')) errors.push('invalid repository');
  if (!COMMIT_RE.test(plugin?.commit || '')) errors.push('invalid commit');

  const canonical = { version: plugin.version, source: { provider: 'github', repo: plugin.repo, commit: plugin.commit } };
  if (plugin?.integrity !== artifactIntegrity(canonical)) errors.push('source identity integrity mismatch');
  return { ok: errors.length === 0, errors };
}

export async function gitHead(targetDir) {
  const { stdout } = await exec('git', ['-C', targetDir, 'rev-parse', 'HEAD'], { windowsHide: true });
  return stdout.trim().toLowerCase();
}

export async function verifyInstalledCommit(targetDir, expectedCommit) {
  const actual = await gitHead(targetDir);
  if (actual !== String(expectedCommit).toLowerCase()) throw new Error(`installed commit mismatch: expected ${expectedCommit}, got ${actual}`);
  return actual;
}

export async function readInstallLock(targetDir) {
  return JSON.parse(await readFile(join(targetDir, '.dsh-install.json'), 'utf8'));
}
