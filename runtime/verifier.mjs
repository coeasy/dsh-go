import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { artifactIntegrity } from '../scripts/checksum.mjs';
import { assertPackageType } from './package-model.mjs';
import { isReleaseArtifact, validateReleaseArtifact } from './artifact-installer.mjs';

const exec = promisify(execFile);
const COMMIT_RE = /^[0-9a-f]{40}$/i;
const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/;
const DEFAULT_GIT_TIMEOUT_MS = 120_000;

export function verifyResolvedPackage(pkg) {
  const errors = [];
  try {
    assertPackageType(pkg?.type || 'plugin');
  } catch (error) {
    errors.push(error.message);
  }
  if (!pkg?.id) errors.push('missing id');
  if (!VERSION_RE.test(pkg?.version || '')) errors.push('invalid version');
  if (pkg?.source?.provider && pkg.source.provider !== 'github') errors.push('unsupported source provider');
  if (!pkg?.repo || !pkg.repo.includes('/')) errors.push('invalid repository');
  if (!COMMIT_RE.test(pkg?.commit || '')) errors.push('invalid commit');

  if (pkg?.version && pkg?.repo && pkg?.commit) {
    const canonical = { version: pkg.version, source: { provider: 'github', repo: pkg.repo, commit: pkg.commit } };
    if (pkg?.integrity !== artifactIntegrity(canonical)) errors.push('source identity integrity mismatch');
  }
  if (isReleaseArtifact(pkg?.artifact)) {
    const release = validateReleaseArtifact(pkg.artifact);
    if (!release.ok) errors.push(...release.errors);
  } else if (pkg?.artifact?.kind && pkg.artifact.kind !== 'git-source') {
    errors.push(`unsupported artifact kind: ${pkg.artifact.kind}`);
  }
  return { ok: errors.length === 0, errors };
}

export function verifyResolvedPlugin(plugin) {
  return verifyResolvedPackage({ ...plugin, type: 'plugin' });
}

export async function gitHead(targetDir, options = {}) {
  const configuredTimeout = Number(options.timeoutMs ?? process.env.DSH_GIT_TIMEOUT_MS);
  const timeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : DEFAULT_GIT_TIMEOUT_MS;
  const { stdout } = await exec('git', ['-C', targetDir, 'rev-parse', 'HEAD'], {
    windowsHide: true,
    timeout,
    killSignal: 'SIGTERM',
  });
  return stdout.trim().toLowerCase();
}

export async function verifyInstalledCommit(targetDir, expectedCommit, options = {}) {
  const actual = await gitHead(targetDir, options);
  if (actual !== String(expectedCommit).toLowerCase()) throw new Error(`installed commit mismatch: expected ${expectedCommit}, got ${actual}`);
  return actual;
}

export function normalizeInstallLock(lock) {
  if (!lock || typeof lock !== 'object') throw new Error('invalid install lock');
  const type = assertPackageType(lock.type || lock.package_type || 'plugin');
  if (!lock.id || !lock.version || !lock.source?.commit) throw new Error('invalid install lock identity');
  return {
    ...lock,
    type,
    package_type: type,
    runtime_registry_version: Number(lock.runtime_registry_version) || 2,
  };
}

export async function readInstallLock(targetDir) {
  return normalizeInstallLock(JSON.parse(await readFile(join(targetDir, '.dsh-install.json'), 'utf8')));
}
