import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { artifactIntegrity } from '../scripts/checksum.mjs';
import { normalizePackageId, normalizePackageType, parseVersion } from '../packages/protocol-core/index.mjs';
import { isReleaseArtifact, validateReleaseArtifact } from './artifact-installer.mjs';

const exec = promisify(execFile);
const COMMIT_RE = /^[0-9a-f]{40}$/i;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const DEFAULT_GIT_TIMEOUT_MS = 120_000;

export function verifyResolvedPackage(pkg) {
  const errors = [];
  let type = null;
  let id = null;
  try { type = normalizePackageType(pkg?.type); } catch (error) { errors.push(error.message); }
  try { id = normalizePackageId(pkg?.id); } catch (error) { errors.push(error.message); }
  try { parseVersion(pkg?.version); } catch (error) { errors.push(error.message); }

  const source = pkg?.source || {};
  const provider = String(source.provider || 'github').toLowerCase();
  const repo = String(source.repo || pkg?.repo || '').trim();
  const commit = String(source.commit || pkg?.commit || '').trim();
  if (provider !== 'github') errors.push(`unsupported source provider: ${provider}`);
  if (!REPO_RE.test(repo)) errors.push('invalid repository');
  if (!COMMIT_RE.test(commit)) errors.push('invalid commit');

  const declaredIntegrity = source.integrity || pkg?.integrity;
  if (declaredIntegrity && pkg?.version && repo && commit) {
    const canonical = { version: pkg.version, source: { provider: 'github', repo, commit } };
    if (declaredIntegrity !== artifactIntegrity(canonical)) errors.push('source identity integrity mismatch');
  }

  if (isReleaseArtifact(pkg?.artifact)) {
    const release = validateReleaseArtifact(pkg.artifact);
    if (!release.ok) errors.push(...release.errors);
  } else if (pkg?.artifact?.kind && pkg.artifact.kind !== 'git-source') {
    errors.push(`unsupported artifact kind: ${pkg.artifact.kind}`);
  }
  return { ok: errors.length === 0, errors, identity: type && id ? `${type}:${id}` : null };
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
  if (lock.schema_version !== 4 || lock.runtime_state_version !== 4 || lock.protocol_version !== 2) {
    const error = new Error('unsupported install lock schema; reinstall the package with the current DSH package manager');
    error.code = 'DSH_STATE_SCHEMA_UNSUPPORTED';
    throw error;
  }
  const type = normalizePackageType(lock.type);
  const id = normalizePackageId(lock.id);
  parseVersion(lock.version);
  if (!COMMIT_RE.test(String(lock.source?.commit || ''))) throw new Error('invalid install lock commit');
  return {
    ...lock,
    type,
    id,
    source: { ...lock.source, commit: String(lock.source.commit).toLowerCase() },
  };
}

export async function readInstallLock(targetDir) {
  return normalizeInstallLock(JSON.parse(await readFile(join(targetDir, '.dsh-install.json'), 'utf8')));
}
