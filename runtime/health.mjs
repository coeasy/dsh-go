import { access } from 'node:fs/promises';
import { discoverPackageManifest } from './bindings.mjs';
import { assertPackageType, normalizePackageDependency, packageKey } from './package-model.mjs';
import { readInstallLock, verifyInstalledCommit } from './verifier.mjs';

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function checkRuntimeRecordHealth(pkg) {
  let type = false;
  try {
    assertPackageType(pkg?.type || 'plugin');
    type = true;
  } catch {
    type = false;
  }
  const checks = {
    type,
    id: Boolean(pkg?.id),
    version: Boolean(pkg?.version),
    source: Boolean(pkg?.commit || pkg?.source?.commit),
    state: Boolean(pkg?.state && pkg.state !== 'removed'),
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  return {
    status: failed.length ? 'failed' : 'healthy',
    checks,
    failed,
    warnings: [],
    checked_at: new Date().toISOString(),
  };
}

export async function checkRuntimePackageHealth(pkg, options = {}) {
  const type = assertPackageType(pkg?.type || 'plugin');
  const base = checkRuntimeRecordHealth({ ...pkg, type });
  const checks = { ...base.checks };
  const warnings = [];
  const target = pkg?.path;
  checks.path = Boolean(target && await exists(target));

  let lock = null;
  if (checks.path) {
    try {
      lock = await readInstallLock(target);
      checks.lock = true;
      checks.lock_type = lock.type === type;
      checks.lock_id = lock.id === pkg.id;
      checks.lock_version = lock.version === pkg.version;
    } catch {
      checks.lock = false;
      checks.lock_type = false;
      checks.lock_id = false;
      checks.lock_version = false;
    }
  } else {
    checks.lock = false;
    checks.lock_type = false;
    checks.lock_id = false;
    checks.lock_version = false;
  }

  if (lock && options.verifyCommit !== false) {
    try {
      await verifyInstalledCommit(target, lock.source.commit);
      checks.commit = true;
    } catch {
      checks.commit = false;
    }
  } else {
    checks.commit = Boolean(lock);
  }

  let manifest = null;
  if (target) {
    try {
      manifest = await discoverPackageManifest(target, type);
    } catch {
      manifest = null;
    }
  }
  checks.manifest = Boolean(manifest?.file);
  if (!checks.manifest) warnings.push('manifest');

  const runtimePackages = options.runtimeRegistry?.packages || options.runtimeRegistry?.plugins;
  if (Array.isArray(runtimePackages)) {
    const dependencies = (pkg.dependencies || []).map((item) => normalizePackageDependency(item, 'plugin'));
    const missing = dependencies.filter((dependency) => {
      const key = packageKey(dependency.type, dependency.id);
      return !runtimePackages.some((entry) =>
        packageKey(entry.type || 'plugin', entry.id) === key && !['removed', 'failed'].includes(entry.state));
    });
    checks.dependencies = missing.length === 0;
    if (missing.length) warnings.push(...missing.map((dependency) => `dependency:${packageKey(dependency.type, dependency.id)}`));
  }

  const critical = ['type', 'id', 'version', 'source', 'state', 'path', 'lock', 'lock_type', 'lock_id', 'lock_version', 'commit'];
  const failed = critical.filter((name) => checks[name] === false);
  return {
    status: failed.length ? 'failed' : warnings.length ? 'warning' : 'healthy',
    checks,
    failed,
    warnings,
    checked_at: new Date().toISOString(),
  };
}

export async function checkRuntimeHealth(plugin, options = {}) {
  return checkRuntimePackageHealth({ ...plugin, type: plugin?.type || 'plugin' }, options);
}

export async function healthSummary(records = [], options = {}) {
  return Promise.all(records.map(async (record) => ({
    id: record.id,
    type: record.type || 'plugin',
    health: await checkRuntimePackageHealth(record, options),
  })));
}
