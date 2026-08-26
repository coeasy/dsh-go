#!/usr/bin/env node
import { dirname } from 'node:path';
import { installPackage } from './installer.mjs';
import { loadInstalledPackage } from './loader.mjs';
import { checkRuntimePackageHealth } from './health.mjs';
import { createRuntimePackageRecord, recordRuntimeEvent } from './lifecycle.mjs';
import { disablePackage, enablePackage } from './platform.mjs';
import { rollbackInstalledPath } from './rollback.mjs';
import {
  buildDependencyPlan,
  loadRegistryFile,
  resolvePackage,
} from './resolver.mjs';
import {
  assertPackageType,
  inferPackageType,
  packageKey,
  parsePackageSpec,
} from './package-model.mjs';
import { readInstallLock, verifyResolvedPackage } from './verifier.mjs';
import { validateRegistry } from '../scripts/validate-registry-v3.mjs';
import {
  findRuntimePackage,
  getRuntimePackage,
  markRuntimePackageRemoved,
  packagePath,
  pathExists,
  readRuntimeRegistry,
  removePath,
  upsertRuntimePackage,
  writeRuntimeRegistry,
} from './registry.mjs';

const PACKAGE_TYPES = ['plugin', 'mcp', 'skill', 'agent'];

function option(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function positional(index) {
  const value = process.argv[index];
  return value && !value.startsWith('--') ? value : undefined;
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

function defaultVersionFor(registry, type, channel) {
  if (channel) return '*';
  return registry.defaults?.[`${type}_version`] || registry.defaults?.plugin_version || '0.1.0';
}

async function loadRuntimePackage(raw, registry, options = {}) {
  const defaultType = assertPackageType(options.type || 'plugin');
  const input = String(raw || '').trim();
  const parsed = parsePackageSpec(input, defaultVersionFor(registry, defaultType, options.channel), defaultType);
  try {
    return resolvePackage(registry, parsed.type, parsed.id, parsed.version, { channel: options.channel });
  } catch (error) {
    const match = (registry.plugins || []).find((item) =>
      inferPackageType(item) === parsed.type
      && item.source?.repo === parsed.id
      && (!options.channel || (item.channel || item.release_channel || 'stable') === options.channel));
    if (!match) throw error;
    return resolvePackage(registry, parsed.type, match.id, parsed.version, { channel: options.channel });
  }
}

function installedRecord(pkg, result, previous = null, action = 'install') {
  const base = previous || createRuntimePackageRecord(pkg.type, pkg.id, pkg.version);
  const rollback = result.backup && previous
    ? { previous_version: previous.version, previous_commit: previous.commit, backup_path: result.backup, created_at: new Date().toISOString() }
    : previous?.rollback || null;
  return recordRuntimeEvent({
    ...base,
    id: pkg.id,
    type: pkg.type,
    version: pkg.version,
    state: 'installed',
    channel: pkg.channel || 'stable',
    path: result.target,
    source: pkg.source,
    commit: pkg.commit,
    capabilities: pkg.capabilities || [],
    dependencies: pkg.dependencies || [],
    runtime: pkg.runtime || {},
    installed_at: new Date().toISOString(),
    enabled: previous?.enabled ?? true,
    activated: false,
    binding: null,
    restart_required: true,
    health: null,
    rollback,
  }, `${action}-complete`, { version: pkg.version, commit: pkg.commit, type: pkg.type });
}

async function persistRecord(record) {
  const registry = await readRuntimeRegistry();
  return writeRuntimeRegistry(upsertRuntimePackage(registry, record));
}

async function markInstalling(pkg, current, action) {
  const base = current || createRuntimePackageRecord(pkg.type, pkg.id, pkg.version);
  const pending = recordRuntimeEvent({
    ...base,
    state: 'installing',
    channel: pkg.channel || current?.channel || 'stable',
    enabled: current?.enabled ?? true,
    activated: false,
    binding: null,
    restart_required: current?.restart_required ?? false,
  }, `${action}-start`, { version: pkg.version, commit: pkg.commit, type: pkg.type });
  await persistRecord(pending);
  return pending;
}

async function markFailed(pkg, current, action, error) {
  const failed = recordRuntimeEvent({
    ...(current || createRuntimePackageRecord(pkg.type, pkg.id, pkg.version)),
    state: 'failed',
    activated: false,
    binding: null,
    health: { status: 'failed', error: error.message, checked_at: new Date().toISOString() },
  }, `${action}-failed`, { error: error.message, type: pkg.type });
  await persistRecord(failed);
}

async function executeInstallPlan(rootPackage, sourceRegistry, options, action = 'install') {
  const initial = await readRuntimeRegistry();
  const plan = buildDependencyPlan(sourceRegistry, rootPackage, {
    channel: options.channel || rootPackage.channel || 'stable',
    installed: initial.packages,
  });
  const results = [];

  for (const pkg of plan.order) {
    const runtime = await readRuntimeRegistry();
    const current = getRuntimePackage(runtime, pkg.type, pkg.id, { includeRemoved: true });
    const packageRootOverride = pkg.type === rootPackage.type ? options.root : undefined;
    const target = current?.path || packagePath(pkg.type, pkg.id, packageRootOverride);
    const exact = current && current.state !== 'removed' && current.version === pkg.version && current.commit === pkg.commit && await pathExists(target);
    const isRoot = packageKey(pkg.type, pkg.id) === packageKey(rootPackage.type, rootPackage.id);
    const shouldReinstallRoot = isRoot && (options.force || options.forceRepair);
    if (exact && !shouldReinstallRoot) {
      results.push({ id: pkg.id, type: pkg.type, skipped: true, reason: 'already-current', target });
      continue;
    }

    const force = isRoot ? options.force || action !== 'install' : Boolean(current && current.state !== 'removed');
    const pending = options.dryRun ? current : await markInstalling(pkg, current, action);
    try {
      const result = await installPackage(pkg, { root: packageRootOverride, force, dryRun: options.dryRun });
      if (!options.dryRun) await persistRecord(installedRecord(pkg, result, pending, action));
      results.push(result);
    } catch (error) {
      if (!options.dryRun) await markFailed(pkg, pending, action, error);
      throw error;
    }
  }

  return {
    id: rootPackage.id,
    type: rootPackage.type,
    key: packageKey(rootPackage.type, rootPackage.id),
    version: rootPackage.version,
    channel: rootPackage.channel || options.channel || 'stable',
    restart_required: !options.dryRun,
    dependency_order: plan.order.map((item) => item.type === 'plugin' ? item.id : packageKey(item.type, item.id)),
    replacements: plan.replacements,
    results,
  };
}

async function installFromSpec(raw, options = {}) {
  const sourceRegistry = await loadRegistryFile(options.catalog);
  const pkg = await loadRuntimePackage(raw, sourceRegistry, options);
  return executeInstallPlan(pkg, sourceRegistry, options, 'install');
}

async function listPackages(type, includeRemoved = false) {
  const registry = await readRuntimeRegistry();
  const packages = registry.packages
    .filter((item) => !type || item.type === type)
    .filter((item) => includeRemoved || item.state !== 'removed')
    .sort((a, b) => packageKey(a.type, a.id).localeCompare(packageKey(b.type, b.id)));
  print(packages);
}

async function statusPackage(type, id, includeRemoved = false) {
  const registry = await readRuntimeRegistry();
  if (!id) {
    return print(registry.packages
      .filter((item) => !type || item.type === type)
      .filter((item) => includeRemoved || item.state !== 'removed')
      .map(({ id: packageId, type: packageType, version, state, channel, enabled, activated, restart_required, health }) => ({
        id: packageId,
        type: packageType,
        key: packageKey(packageType, packageId),
        version,
        state,
        channel,
        enabled,
        activated,
        restart_required,
        health: health?.status || null,
      })));
  }
  const item = type
    ? getRuntimePackage(registry, type, id, { includeRemoved })
    : findRuntimePackage(registry, id, { includeRemoved });
  if (!item) throw new Error(`runtime package is not installed: ${type ? `${type}:` : ''}${id}`);
  print(item);
}

async function removePackage(type, id) {
  const registry = await readRuntimeRegistry();
  const item = getRuntimePackage(registry, type, id);
  if (!item) throw new Error(`runtime package is not installed: ${type}:${id}`);
  const target = item.path || packagePath(type, id);
  await removePath(target);
  await removePath(target + '.backup');
  const next = markRuntimePackageRemoved(registry, type, id, { path: target });
  await writeRuntimeRegistry(next);
  print({ id, type, key: packageKey(type, id), removed: true, path: target, restart_required: true });
}

async function updatePackage(type, id, version, options) {
  const runtime = await readRuntimeRegistry();
  const current = getRuntimePackage(runtime, type, id);
  if (!current) throw new Error(`runtime package is not installed: ${type}:${id}`);
  const sourceRegistry = await loadRegistryFile(options.catalog);
  const channel = options.channel || current.channel || 'stable';
  const pkg = resolvePackage(sourceRegistry, type, id, version || '*', { channel });
  if (!options.forceRepair && current.version === pkg.version && current.commit === pkg.commit && await pathExists(current.path || packagePath(type, id))) {
    return print({ id, type, version: current.version, commit: current.commit, up_to_date: true });
  }
  const installRoot = options.root || (current.path ? dirname(current.path) : undefined);
  const result = await executeInstallPlan(pkg, sourceRegistry, { ...options, root: installRoot, force: true }, options.forceRepair ? 'repair' : 'update');
  print({ ...result, updated: !options.forceRepair, repaired: Boolean(options.forceRepair) });
}

async function rollbackPackage(type, id) {
  const registry = await readRuntimeRegistry();
  const item = getRuntimePackage(registry, type, id);
  if (!item) throw new Error(`runtime package is not installed: ${type}:${id}`);
  const target = item.path || packagePath(type, id);
  const { lock } = await rollbackInstalledPath(target);
  if (lock.type !== type || lock.id !== id) throw new Error(`rollback lock identity mismatch for ${type}:${id}`);
  const next = recordRuntimeEvent({
    ...item,
    type,
    version: lock.version,
    source: lock.source,
    commit: lock.source.commit,
    channel: lock.channel || item.channel || 'stable',
    state: 'installed',
    activated: false,
    binding: null,
    restart_required: true,
    health: null,
    rollback: null,
    restored_at: new Date().toISOString(),
  }, 'rollback-complete', { version: lock.version, commit: lock.source.commit, type });
  await writeRuntimeRegistry(upsertRuntimePackage(registry, next));
  print({ id, type, rolled_back: true, version: lock.version, commit: lock.source.commit, restart_required: true });
}

async function setPackageEnabled(type, id, enabled) {
  const registry = await readRuntimeRegistry();
  const item = getRuntimePackage(registry, type, id);
  if (!item) throw new Error(`runtime package is not installed: ${type}:${id}`);
  const next = enabled ? enablePackage(item) : disablePackage(item);
  await writeRuntimeRegistry(upsertRuntimePackage(registry, next));
  print({ id, type, enabled: next.enabled, state: next.state, restart_required: true });
}

async function healthPackages(type, id, options = {}) {
  const registry = await readRuntimeRegistry();
  const records = id
    ? [getRuntimePackage(registry, type, id)].filter(Boolean)
    : registry.packages.filter((item) => (!type || item.type === type) && item.state !== 'removed');
  if (id && records.length === 0) throw new Error(`runtime package is not installed: ${type}:${id}`);
  const results = [];
  let next = registry;
  for (const record of records) {
    const health = await checkRuntimePackageHealth(record, { runtimeRegistry: registry });
    results.push({ id: record.id, type: record.type, health });
    next = upsertRuntimePackage(next, { ...record, health });
  }
  if (records.length) await writeRuntimeRegistry(next);
  const payload = { healthy: results.every((item) => item.health.status === 'healthy'), packages: results };
  if (type === 'plugin') payload.plugins = results;
  print(id ? results[0] : payload);
  if (!options.noExitCode && results.some((item) => item.health.status === 'failed')) process.exitCode = 1;
  return payload;
}

async function repairPackage(type, id, options) {
  const registry = await readRuntimeRegistry();
  const current = getRuntimePackage(registry, type, id);
  if (!current) throw new Error(`runtime package is not installed: ${type}:${id}`);
  const health = await checkRuntimePackageHealth(current, { runtimeRegistry: registry });
  if (health.status === 'healthy') return print({ id, type, repaired: false, reason: 'healthy' });
  return updatePackage(type, id, current.version, { ...options, channel: options.channel || current.channel, forceRepair: true });
}

async function historyPackage(type, id) {
  const registry = await readRuntimeRegistry();
  const item = getRuntimePackage(registry, type, id, { includeRemoved: true });
  if (!item) throw new Error(`runtime package has no history: ${type}:${id}`);
  print({ id, type, history: item.history || [] });
}

function typedSpec(raw, defaultType) {
  return parsePackageSpec(raw, '0.1.0', defaultType);
}

async function packageCommand(command, options, includeRemoved) {
  const typed = PACKAGE_TYPES.includes(command);
  const type = typed ? command : option('--type');
  const normalizedType = type ? assertPackageType(type) : null;
  const action = process.argv[3] || 'list';
  const raw = positional(4);

  if (action === 'list') return listPackages(normalizedType, includeRemoved);
  if (action === 'status') {
    if (!raw) return statusPackage(normalizedType, undefined, includeRemoved);
    const parsed = typedSpec(raw, normalizedType || 'plugin');
    return statusPackage(parsed.type, parsed.id, includeRemoved);
  }
  if (action === 'add' || action === 'install') return print(await installFromSpec(raw, { ...options, type: normalizedType || 'plugin' }));
  if (action === 'health' || action === 'doctor') {
    if (!raw) return healthPackages(normalizedType, undefined);
    const parsed = typedSpec(raw, normalizedType || 'plugin');
    return healthPackages(parsed.type, parsed.id);
  }
  if (!raw) throw new Error(`runtime package id is required for ${action}`);
  const parsed = typedSpec(raw, normalizedType || 'plugin');
  if (action === 'remove' || action === 'uninstall') return removePackage(parsed.type, parsed.id);
  if (action === 'update') return updatePackage(parsed.type, parsed.id, positional(5), options);
  if (action === 'rollback') return rollbackPackage(parsed.type, parsed.id);
  if (action === 'repair') return repairPackage(parsed.type, parsed.id, options);
  if (action === 'enable') return setPackageEnabled(parsed.type, parsed.id, true);
  if (action === 'disable') return setPackageEnabled(parsed.type, parsed.id, false);
  if (action === 'history') return historyPackage(parsed.type, parsed.id);
  throw new Error(`unknown ${command} action: ${action}`);
}

async function main() {
  const command = process.argv[2] || 'check-registry';
  const catalog = option('--registry', 'catalog/registry-v3.json');
  const root = option('--root');
  const channel = option('--channel');
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');
  const includeRemoved = process.argv.includes('--all');
  const options = { catalog, root, channel, dryRun, force };

  if (command === 'package' || PACKAGE_TYPES.includes(command)) {
    return packageCommand(command, options, includeRemoved);
  }

  if (command === 'check-registry') {
    const registry = await loadRegistryFile(catalog);
    const result = validateRegistry(registry);
    if (result.errors.length) throw new Error(result.errors.join('; '));
    const seenTypes = new Set();
    for (const item of registry.plugins || []) {
      const type = inferPackageType(item);
      if (seenTypes.has(type)) continue;
      const resolved = resolvePackage(registry, type, item.id, item.version, { channel: item.channel || item.release_channel || 'stable' });
      const verification = verifyResolvedPackage(resolved);
      if (!verification.ok) throw new Error(verification.errors.join('; '));
      seenTypes.add(type);
    }
    console.log(`Runtime registry check passed: ${(registry.plugins || []).length} catalog records, ${seenTypes.size} package type(s)`);
    return;
  }

  if (command === 'resolve') {
    const registry = await loadRegistryFile(catalog);
    const parsed = parsePackageSpec(process.argv[3], channel ? '*' : registry.defaults?.plugin_version, option('--type', 'plugin'));
    print(resolvePackage(registry, parsed.type, parsed.id, parsed.version, { channel }));
    return;
  }

  if (command === 'install') {
    const parsed = parsePackageSpec(process.argv[3], undefined, option('--type', 'plugin'));
    const result = await installFromSpec(process.argv[3], { ...options, type: parsed.type });
    print(result);
    if (!dryRun) console.log('Install verified. Restart the client to activate the runtime package.');
    return;
  }

  if (command === 'load') {
    const spec = parsePackageSpec(process.argv[3], '0.1.0', option('--type', 'plugin'));
    print(await loadInstalledPackage(spec.type, spec.id, { root, version: spec.version }));
    return;
  }

  if (command === 'lock') {
    const spec = parsePackageSpec(process.argv[3], '0.1.0', option('--type', 'plugin'));
    print(await readInstallLock(packagePath(spec.type, spec.id, root || undefined)));
    return;
  }

  throw new Error('unknown runtime command: ' + command);
}

main().catch((error) => {
  console.error('[runtime] ' + (error.stack || error.message));
  process.exit(1);
});
