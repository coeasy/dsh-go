import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readInstallLock, verifyInstalledCommit } from './verifier.mjs';

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function checkRuntimeRecordHealth(plugin) {
  const checks = {
    id: Boolean(plugin?.id),
    version: Boolean(plugin?.version),
    source: Boolean(plugin?.commit || plugin?.source?.commit),
    state: Boolean(plugin?.state && plugin.state !== 'removed'),
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

export async function checkRuntimeHealth(plugin, options = {}) {
  const base = checkRuntimeRecordHealth(plugin);
  const checks = { ...base.checks };
  const warnings = [];
  const target = plugin?.path;
  checks.path = Boolean(target && await exists(target));

  let lock = null;
  if (checks.path) {
    try {
      lock = await readInstallLock(target);
      checks.lock = true;
      checks.lock_id = lock.id === plugin.id;
      checks.lock_version = lock.version === plugin.version;
    } catch {
      checks.lock = false;
      checks.lock_id = false;
      checks.lock_version = false;
    }
  } else {
    checks.lock = false;
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
  for (const file of ['dsh-plugin.json', 'package.json']) {
    if (!target || !await exists(join(target, file))) continue;
    try {
      manifest = JSON.parse(await readFile(join(target, file), 'utf8'));
      break;
    } catch {
      // Continue to report the manifest check below.
    }
  }
  checks.manifest = Boolean(manifest);
  if (!checks.manifest) warnings.push('manifest');

  if (Array.isArray(options.runtimeRegistry?.plugins)) {
    const dependencies = (plugin.dependencies || []).map((item) => typeof item === 'string' ? item.split('@')[0] : item.id);
    const missing = dependencies.filter((id) => !options.runtimeRegistry.plugins.some((entry) => entry.id === id && !['removed', 'failed'].includes(entry.state)));
    checks.dependencies = missing.length === 0;
    if (missing.length) warnings.push(...missing.map((id) => `dependency:${id}`));
  }

  const critical = ['id', 'version', 'source', 'state', 'path', 'lock', 'lock_id', 'lock_version', 'commit'];
  const failed = critical.filter((name) => checks[name] === false);
  return {
    status: failed.length ? 'failed' : warnings.length ? 'warning' : 'healthy',
    checks,
    failed,
    warnings,
    checked_at: new Date().toISOString(),
  };
}

export async function healthSummary(records = [], options = {}) {
  return Promise.all(records.map(async (record) => ({ id: record.id, health: await checkRuntimeHealth(record, options) })));
}
