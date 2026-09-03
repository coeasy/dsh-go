#!/usr/bin/env node
import { dirname } from 'node:path';
import { rename } from 'node:fs/promises';
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
  parsePackageRequest,
} from './package-model.mjs';
import { readInstallLock, verifyResolvedPackage } from './verifier.mjs';
import { validateRegistry } from '../scripts/validate-registry-v3.mjs';
import {
  findRuntimePackage,
  getRuntimePackage,
  packagePath,
  pathExists,
  readRuntimeRegistry,
  removePath,
  updateRuntimeRegistry,
  upsertRuntimePackage,
} from './registry.mjs';
import { cliJsonMode, printCliError, printCliMessage, printCliValue } from './cli-output.mjs';
import { operationActivationState, packageActivationState, withPackageActivationState } from './package-status.mjs';
import { cliLanguage, translate } from './i18n.mjs';
import { removeRuntimePackageSafe } from './dependency-guard.mjs';
import { withPackageOperationLock } from './package-operation-lock.mjs';

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
  return printCliValue(value);
}

async function loadRuntimePackage(raw, registry, options = {}) {
  const defaultType = assertPackageType(options.type || 'plugin');
  const request = parsePackageRequest(String(raw || '').trim(), {
    defaultVersion: '*',
    defaultType,
    channel: options.channel || 'stable',
    registry: options.catalog || null,
  });
  try {
    return resolvePackage(registry, request.type, request.id, request.versionRange, { channel: request.channel });
  } catch (error) {
    const match = (registry.plugins || []).find((item) =>
      inferPackageType(item) === request.type
      && item.source?.repo === request.id
      && (item.channel || item.release_channel || 'stable') === request.channel);
    if (!match) throw error;
    return resolvePackage(registry, request.type, match.id, request.versionRange, { channel: request.channel });
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
    state: 'pending-restart',
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

async function persistRecord(record, registryFile) {
  return updateRuntimeRegistry((registry) => upsertRuntimePackage(registry, record), registryFile);
}

async function markInstalling(pkg, current, action, registryFile) {
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
  await persistRecord(pending, registryFile);
  return pending;
}

async function markFailed(pkg, current, action, error, registryFile) {
  const failed = recordRuntimeEvent({
    ...(current || createRuntimePackageRecord(pkg.type, pkg.id, pkg.version)),
    state: 'failed',
    activated: false,
    binding: null,
    health: { status: 'failed', error: error.message, checked_at: new Date().toISOString() },
  }, `${action}-failed`, { error: error.message, code: error.code || null, type: pkg.type });
  await persistRecord(failed, registryFile);
}

async function restorePreviousRuntimeState(pkg, current, action, error, registryFile) {
  const restored = recordRuntimeEvent({ ...current }, `${action}-rolled-back`, {
    attempted_version: pkg.version,
    attempted_commit: pkg.commit,
    error: error.message,
    code: error.code || null,
    type: pkg.type,
  });
  await persistRecord(restored, registryFile);
  error.rollback_restored = true;
  error.rollback_package = {
    id: current.id,
    type: current.type,
    key: packageKey(current.type || 'plugin', current.id),
    version: current.version,
    commit: current.commit || null,
    activation_state: packageActivationState(current),
  };
  if (!error.code) error.code = 'DSH_PACKAGE_OPERATION_ROLLED_BACK';
}

async function restoreInstalledFilesystem(result) {
  if (!result?.target) return;
  await removePath(result.target);
  if (result.backup && await pathExists(result.backup)) await rename(result.backup, result.target);
}

async function executeInstallPlan(rootPackage, sourceRegistry, options, action = 'install') {
  const initial = await readRuntimeRegistry(options.registryFile);
  const plan = buildDependencyPlan(sourceRegistry, rootPackage, {
    channel: options.channel || rootPackage.channel || 'stable',
    installed: initial.packages,
  });
  const results = [];

  for (const pkg of plan.order) {
    const isRoot = packageKey(pkg.type, pkg.id) === packageKey(rootPackage.type, rootPackage.id);
    const shouldReinstallRoot = isRoot && (options.force || options.forceRepair);

    let packageRootOverride;
    let current = null;
    let pending = current;
    let result = null;
    let skipped = null;
    await withPackageOperationLock(pkg.type, pkg.id, async () => {
      const runtime = await readRuntimeRegistry(options.registryFile);
      current = getRuntimePackage(runtime, pkg.type, pkg.id, { includeRemoved: true });
      packageRootOverride = current?.path
        ? dirname(current.path)
        : pkg.type === rootPackage.type ? options.root : undefined;
      const target = current?.path || packagePath(pkg.type, pkg.id, packageRootOverride);
      const exact = current && current.state !== 'removed'
        && current.version === pkg.version
        && current.commit === pkg.commit
        && await pathExists(target);
      if (exact && !shouldReinstallRoot) {
        skipped = { id: pkg.id, type: pkg.type, skipped: true, reason: 'already-current', target, activation_state: packageActivationState(current) };
        return;
      }

      const force = isRoot ? options.force || action !== 'install' : Boolean(current && current.state !== 'removed');
      pending = options.dryRun ? current : await markInstalling(pkg, current, action, options.registryFile);
      try {
        result = await installPackage(pkg, {
          ...options,
          root: packageRootOverride,
          force,
          dryRun: options.dryRun,
          operationLockHeld: true,
        });
        if (!options.dryRun) {
          try {
            await persistRecord(installedRecord(pkg, result, pending, action), options.registryFile);
          } catch (persistError) {
            try { await restoreInstalledFilesystem(result); } catch (rollbackError) { persistError.filesystem_rollback_error = rollbackError.message; }
            throw persistError;
          }
        }
      } catch (error) {
        if (!options.dryRun) {
          try {
            if (current && current.state !== 'removed') await restorePreviousRuntimeState(pkg, current, action, error, options.registryFile);
            else await markFailed(pkg, pending, action, error, options.registryFile);
          } catch (stateError) {
            error.registry_rollback_error = stateError.message;
          }
        }
        throw error;
      }
    }, options);
    if (skipped) {
      results.push(skipped);
      continue;
    }
    results.push({ ...result, activation_state: operationActivationState({ dryRun: options.dryRun }) });
  }

  return {
    id: rootPackage.id,
    type: rootPackage.type,
    key: packageKey(rootPackage.type, rootPackage.id),
    version: rootPackage.version,
    channel: rootPackage.channel || options.channel || 'stable',
    activation_state: operationActivationState({ dryRun: options.dryRun }),
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

async function listPackages(type, includeRemoved = false, options = {}) {
  const registry = await readRuntimeRegistry(options.registryFile);
  const packages = registry.packages
    .filter((item) => !type || item.type === type)
    .filter((item) => includeRemoved || item.state !== 'removed')
    .sort((a, b) => packageKey(a.type, a.id).localeCompare(packageKey(b.type, b.id)))
    .map(withPackageActivationState);
  print(packages);
}

async function statusPackage(type, id, includeRemoved = false, options = {}) {
  const registry = await readRuntimeRegistry(options.registryFile);
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
        activation_state: packageActivationState({ state, enabled, activated, restart_required }),
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
  print(withPackageActivationState(item));
}

async function removePackage(type, id, options = {}) {
  const result = await removeRuntimePackageSafe(type, id, options);
  const removed = result.removed.find((item) => item.type === type && item.id === id);
  print({
    id,
    type,
    key: packageKey(type, id),
    removed: true,
    path: removed?.path || packagePath(type, id),
    activation_state: 'removed',
    restart_required: true,
  });
}

async function updatePackage(type, id, version, options) {
  const runtime = await readRuntimeRegistry(options.registryFile);
  const current = getRuntimePackage(runtime, type, id);
  if (!current) throw new Error(`runtime package is not installed: ${type}:${id}`);
  const sourceRegistry = await loadRegistryFile(options.catalog);
  const channel = options.channel || current.channel || 'stable';
  const pkg = resolvePackage(sourceRegistry, type, id, version || '*', { channel });
  const result = await executeInstallPlan(pkg, sourceRegistry, { ...options, root: options.root, force: Boolean(options.force) }, options.forceRepair ? 'repair' : 'update');
  const rootResult = result.results?.find((item) => item.type === type && item.id === id);
  if (!options.forceRepair && rootResult?.skipped) {
    const latest = await readRuntimeRegistry(options.registryFile);
    const latestCurrent = getRuntimePackage(latest, type, id);
    return print({ id, type, version: latestCurrent?.version || pkg.version, commit: latestCurrent?.commit || pkg.commit, up_to_date: true, activation_state: latestCurrent ? packageActivationState(latestCurrent) : 'unknown' });
  }
  print({ ...result, updated: !options.forceRepair, repaired: Boolean(options.forceRepair) });
}

async function rollbackPackage(type, id, options = {}) {
  return withPackageOperationLock(type, id, async () => {
    const registry = await readRuntimeRegistry(options.registryFile);
    const item = getRuntimePackage(registry, type, id);
    if (!item) throw new Error(`runtime package is not installed: ${type}:${id}`);
    const target = item.path || packagePath(type, id);
    const { lock } = await rollbackInstalledPath(target, { type, id, ...options, operationLockHeld: true });
    if (lock.type !== type || lock.id !== id) throw new Error(`rollback lock identity mismatch for ${type}:${id}`);
    const next = recordRuntimeEvent({
      ...item,
      type,
      version: lock.version,
      source: lock.source,
      commit: lock.source.commit,
      channel: lock.channel || item.channel || 'stable',
      state: 'pending-restart',
      activated: false,
      binding: null,
      restart_required: true,
      health: null,
      rollback: null,
      restored_at: new Date().toISOString(),
    }, 'rollback-complete', { version: lock.version, commit: lock.source.commit, type });
    await persistRecord(next, options.registryFile);
    print({ id, type, rolled_back: true, version: lock.version, commit: lock.source.commit, activation_state: 'pending-restart', restart_required: true });
  }, options);
}

async function setPackageEnabled(type, id, enabled, options = {}) {
  return withPackageOperationLock(type, id, async () => {
    const registry = await readRuntimeRegistry(options.registryFile);
    const item = getRuntimePackage(registry, type, id);
    if (!item) throw new Error(`runtime package is not installed: ${type}:${id}`);
    const next = enabled ? enablePackage(item) : disablePackage(item);
    await persistRecord(next, options.registryFile);
    print({ id, type, enabled: next.enabled, state: next.state, activation_state: packageActivationState(next), restart_required: true });
  }, options);
}

async function healthPackages(type, id, options = {}) {
  const registry = await readRuntimeRegistry(options.registryFile);
  const records = id
    ? [getRuntimePackage(registry, type, id)].filter(Boolean)
    : registry.packages.filter((item) => (!type || item.type === type) && item.state !== 'removed');
  if (id && records.length === 0) throw new Error(`runtime package is not installed: ${type}:${id}`);
  const results = [];
  for (const record of records) {
    await withPackageOperationLock(record.type, record.id, async () => {
      const latest = await readRuntimeRegistry(options.registryFile);
      const current = getRuntimePackage(latest, record.type, record.id);
      if (!current) return;
      const health = await checkRuntimePackageHealth(current, { runtimeRegistry: latest });
      results.push({ id: current.id, type: current.type, activation_state: packageActivationState(current), health });
      await persistRecord({ ...current, health }, options.registryFile);
    }, options);
  }
  if (id && results.length === 0) throw new Error(`runtime package is not installed: ${type}:${id}`);
  const payload = { healthy: results.every((item) => item.health.status === 'healthy'), packages: results };
  if (type === 'plugin') payload.plugins = results;
  print(id ? results[0] : payload);
  if (!options.noExitCode && results.some((item) => item.health.status === 'failed')) process.exitCode = 1;
  return payload;
}

async function repairPackage(type, id, options) {
  const registry = await readRuntimeRegistry(options.registryFile);
  const current = getRuntimePackage(registry, type, id);
  if (!current) throw new Error(`runtime package is not installed: ${type}:${id}`);
  const health = await checkRuntimePackageHealth(current, { runtimeRegistry: registry });
  if (health.status === 'healthy') return print({ id, type, repaired: false, reason: 'healthy', activation_state: packageActivationState(current) });
  return updatePackage(type, id, current.version, { ...options, channel: options.channel || current.channel, forceRepair: true });
}

async function historyPackage(type, id, options = {}) {
  const registry = await readRuntimeRegistry(options.registryFile);
  const item = getRuntimePackage(registry, type, id, { includeRemoved: true });
  if (!item) throw new Error(`runtime package has no history: ${type}:${id}`);
  print({ id, type, activation_state: packageActivationState(item), history: item.history || [] });
}

function typedSpec(raw, defaultType) {
  return parsePackageRequest(raw, { defaultVersion: '*', defaultType });
}

async function packageCommand(command, options, includeRemoved) {
  const typed = PACKAGE_TYPES.includes(command);
  const type = typed ? command : option('--type');
  const normalizedType = type ? assertPackageType(type) : null;
  const action = process.argv[3] || 'list';
  const raw = positional(4);

  if (action === 'list') return listPackages(normalizedType, includeRemoved, options);
  if (action === 'status') {
    if (!raw) return statusPackage(normalizedType, undefined, includeRemoved, options);
    const parsed = typedSpec(raw, normalizedType || 'plugin');
    return statusPackage(parsed.type, parsed.id, includeRemoved, options);
  }
  if (action === 'add' || action === 'install') return print(await installFromSpec(raw, { ...options, type: normalizedType || 'plugin' }));
  if (action === 'health' || action === 'doctor') {
    if (!raw) return healthPackages(normalizedType, undefined, options);
    const parsed = typedSpec(raw, normalizedType || 'plugin');
    return healthPackages(parsed.type, parsed.id, options);
  }
  if (!raw) throw new Error(`runtime package id is required for ${action}`);
  const parsed = typedSpec(raw, normalizedType || 'plugin');
  if (action === 'remove' || action === 'uninstall') return removePackage(parsed.type, parsed.id, options);
  if (action === 'update') return updatePackage(parsed.type, parsed.id, positional(5), options);
  if (action === 'rollback') return rollbackPackage(parsed.type, parsed.id, options);
  if (action === 'repair') return repairPackage(parsed.type, parsed.id, options);
  if (action === 'enable') return setPackageEnabled(parsed.type, parsed.id, true, options);
  if (action === 'disable') return setPackageEnabled(parsed.type, parsed.id, false, options);
  if (action === 'history') return historyPackage(parsed.type, parsed.id, options);
  throw new Error(`unknown ${command} action: ${action}`);
}

async function main() {
  const command = process.argv[2] || 'check-registry';
  const catalog = option('--registry', 'catalog/registry-v3.json');
  const root = option('--root');
  const registryFile = option('--runtime-registry');
  const channel = option('--channel');
  const enterprisePolicyFile = option('--policy-file');
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');
  const includeRemoved = process.argv.includes('--all');
  const options = { catalog, root, channel, dryRun, force, registryFile, enterprisePolicyFile };

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
    const summary = { passed: true, catalog_records: (registry.plugins || []).length, package_types: seenTypes.size };
    if (cliJsonMode()) print(summary);
    else console.log(`Runtime registry check passed: ${summary.catalog_records} catalog records, ${summary.package_types} package type(s)`);
    return;
  }

  if (command === 'resolve') {
    const registry = await loadRegistryFile(catalog);
    const request = parsePackageRequest(process.argv[3], { defaultVersion: '*', defaultType: option('--type', 'plugin'), channel: channel || 'stable', registry: catalog });
    print(resolvePackage(registry, request.type, request.id, request.versionRange, { channel: request.channel }));
    return;
  }

  if (command === 'install') {
    const request = parsePackageRequest(process.argv[3], { defaultVersion: '*', defaultType: option('--type', 'plugin'), channel: channel || 'stable', registry: catalog });
    const result = await installFromSpec(process.argv[3], { ...options, type: request.type, channel: request.channel });
    print(result);
    if (!dryRun) printCliMessage(translate('install_verified_restart', cliLanguage()));
    return;
  }

  if (command === 'load') {
    const request = parsePackageRequest(process.argv[3], { defaultVersion: '0.1.0', defaultType: option('--type', 'plugin') });
    print(await loadInstalledPackage(request.type, request.id, { root, version: request.version, registryFile }));
    return;
  }

  if (command === 'lock') {
    const request = parsePackageRequest(process.argv[3], { defaultVersion: '0.1.0', defaultType: option('--type', 'plugin') });
    print(await readInstallLock(packagePath(request.type, request.id, root || undefined)));
    return;
  }

  throw new Error('unknown runtime command: ' + command);
}

main().catch((error) => {
  printCliError(error, { prefix: '[runtime]' });
  process.exitCode = 1;
});
