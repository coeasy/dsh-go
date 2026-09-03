import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { arch, platform as currentPlatform } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { compareVersions, satisfiesVersion } from './semver.mjs';

const exec = promisify(execFile);
const DEFAULT_REPOSITORY = 'coeasy/dsh-go';
const DEFAULT_CHECK_TIMEOUT_MS = 15_000;
const DEFAULT_INSTALL_TIMEOUT_MS = 120_000;

function positiveOption(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeRepository(value) {
  const repository = String(value || '').trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('repository must be owner/name');
  return repository;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function findDshOnPath(options = {}) {
  const platform = options.platform || currentPlatform();
  const env = options.env || process.env;
  const names = platform === 'win32' ? ['dsh.cmd', 'dsh.exe', 'dsh.bat', 'dsh'] : ['dsh'];
  for (const entry of String(env.PATH || '').split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = join(entry, name);
      if (await exists(candidate)) return candidate;
    }
  }
  return null;
}

export async function runtimeEnvironment(packageVersion, options = {}) {
  const nodeVersion = options.nodeVersion || process.versions.node;
  const command = await findDshOnPath(options);
  return {
    runtime_version: packageVersion,
    node_version: nodeVersion,
    node_supported: satisfiesVersion(nodeVersion, '>=20.0.0'),
    platform: options.platform || currentPlatform(),
    arch: options.arch || arch(),
    command,
    path_registered: Boolean(command),
  };
}

export async function checkForRuntimeUpdate(currentVersion, options = {}) {
  const repository = normalizeRepository(options.repository || DEFAULT_REPOSITORY);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable; Node.js 20+ is required');
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': `dsh-go/${currentVersion}`,
    },
    signal: AbortSignal.timeout(positiveOption(options.timeoutMs, DEFAULT_CHECK_TIMEOUT_MS)),
  });
  if (!response.ok) throw new Error(`failed to check runtime update: GitHub HTTP ${response.status}`);
  const release = await response.json();
  const tag = String(release.tag_name || '').trim();
  const latestVersion = tag.replace(/^v/, '');
  if (!latestVersion) throw new Error('latest GitHub release has no tag_name');
  const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
  return {
    repository,
    current_version: currentVersion,
    latest_version: latestVersion,
    tag,
    update_available: updateAvailable,
    release_url: release.html_url || null,
  };
}

export async function updateRuntime(currentVersion, options = {}) {
  const check = await checkForRuntimeUpdate(currentVersion, options);
  if (!check.update_available) return { ...check, updated: false, reason: 'already-current' };
  const installSpec = `github:${check.repository}#${check.tag}`;
  if (options.dryRun) return { ...check, updated: false, dry_run: true, install_spec: installSpec };

  const npm = (options.platform || currentPlatform()) === 'win32' ? 'npm.cmd' : 'npm';
  await exec(npm, ['install', '--global', installSpec], {
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    timeout: positiveOption(options.installTimeoutMs, DEFAULT_INSTALL_TIMEOUT_MS),
    killSignal: 'SIGTERM',
  });
  return { ...check, updated: true, install_spec: installSpec };
}
