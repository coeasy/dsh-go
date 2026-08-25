#!/usr/bin/env node
import { dirname } from 'node:path';
import { installPlugin } from './installer.mjs';
import { loadInstalledPlugin } from './loader.mjs';
import { checkRuntimeHealth } from './health.mjs';
import { createRuntimeRecord, recordRuntimeEvent } from './lifecycle.mjs';
import { disablePlugin, enablePlugin } from './platform.mjs';
import { rollbackInstalledPath } from './rollback.mjs';
import { buildDependencyPlan, loadRegistryFile, parsePluginSpec, resolvePlugin } from './resolver.mjs';
import { readInstallLock, verifyResolvedPlugin } from './verifier.mjs';
import { validateRegistry } from '../scripts/validate-registry-v3.mjs';
import {
  getRuntimePlugin,
  markRuntimePluginRemoved,
  pathExists,
  pluginPath,
  readRuntimeRegistry,
  removePath,
  upsertRuntimePlugin,
  writeRuntimeRegistry,
} from './registry.mjs';

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

async function loadRuntimePlugin(raw, registry, options = {}) {
  const input = String(raw || '').replace(/^github:/, '');
  const defaultVersion = options.channel ? '*' : registry.defaults?.plugin_version;
  const parsed = parsePluginSpec(input, defaultVersion);
  try {
    return resolvePlugin(registry, parsed.id, parsed.version, { channel: options.channel });
  } catch (error) {
    const at = input.lastIndexOf('@');
    const repo = at > 0 ? input.slice(0, at) : input;
    const version = at > 0 ? input.slice(at + 1) : defaultVersion || '0.1.0';
    const match = (registry.plugins || []).find((item) =>
      item.source?.repo === repo && (!options.channel || (item.channel || item.release_channel || 'stable') === options.channel));
    if (!match) throw error;
    return resolvePlugin(registry, match.id, version, { channel: options.channel });
  }
}

function installedRecord(plugin, result, previous = null, action = 'install') {
  const base = previous || createRuntimeRecord(plugin.id, plugin.version);
  const rollback = result.backup && previous
    ? { previous_version: previous.version, previous_commit: previous.commit, backup_path: result.backup, created_at: new Date().toISOString() }
    : previous?.rollback || null;
  return recordRuntimeEvent({
    ...base,
    id: plugin.id,
    type: 'plugin',
    version: plugin.version,
    state: 'installed',
    channel: plugin.channel || 'stable',
    path: result.target,
    source: plugin.source,
    commit: plugin.commit,
    dependencies: plugin.dependencies || [],
    installed_at: new Date().toISOString(),
    enabled: previous?.enabled ?? true,
    activated: false,
    restart_required: true,
    health: null,
    rollback,
  }, `${action}-complete`, { version: plugin.version, commit: plugin.commit });
}

async function persistRecord(record) {
  const registry = await readRuntimeRegistry();
  return writeRuntimeRegistry(upsertRuntimePlugin(registry, record));
}

async function markInstalling(plugin, current, action) {
  const base = current || createRuntimeRecord(plugin.id, plugin.version);
  const pending = recordRuntimeEvent({
    ...base,
    state: 'installing',
    channel: plugin.channel || current?.channel || 'stable',
    enabled: current?.enabled ?? true,
    activated: false,
    restart_required: current?.restart_required ?? false,
  }, `${action}-start`, { version: plugin.version, commit: plugin.commit });
  await persistRecord(pending);
  return pending;
}

async function markFailed(plugin, current, action, error) {
  const failed = recordRuntimeEvent({
    ...(current || createRuntimeRecord(plugin.id, plugin.version)),
    state: 'failed',
    activated: false,
    health: { status: 'failed', error: error.message, checked_at: new Date().toISOString() },
  }, `${action}-failed`, { error: error.message });
  await persistRecord(failed);
}

async function executeInstallPlan(rootPlugin, sourceRegistry, options, action = 'install') {
  const initial = await readRuntimeRegistry();
  const plan = buildDependencyPlan(sourceRegistry, rootPlugin, {
    channel: options.channel || rootPlugin.channel || 'stable',
    installed: initial.plugins,
  });
  const results = [];

  for (const plugin of plan.order) {
    const runtime = await readRuntimeRegistry();
    const current = getRuntimePlugin(runtime, plugin.id, { includeRemoved: true });
    const target = current?.path || pluginPath(plugin.id, options.root);
    const exact = current && current.state !== 'removed' && current.version === plugin.version && current.commit === plugin.commit && await pathExists(target);
    const isRoot = plugin.id === rootPlugin.id;
    if (exact && (!isRoot || !options.forceRepair)) {
      results.push({ id: plugin.id, skipped: true, reason: 'already-current', target });
      continue;
    }

    const force = isRoot ? options.force || action !== 'install' : Boolean(current && current.state !== 'removed');
    const pending = options.dryRun ? current : await markInstalling(plugin, current, action);
    try {
      const result = await installPlugin(plugin, { root: options.root, force, dryRun: options.dryRun });
      if (!options.dryRun) await persistRecord(installedRecord(plugin, result, pending, action));
      results.push(result);
    } catch (error) {
      if (!options.dryRun) await markFailed(plugin, pending, action, error);
      throw error;
    }
  }

  return {
    id: rootPlugin.id,
    version: rootPlugin.version,
    channel: rootPlugin.channel || options.channel || 'stable',
    restart_required: !options.dryRun,
    dependency_order: plan.order.map((item) => item.id),
    replacements: plan.replacements,
    results,
  };
}

async function installFromSpec(raw, options) {
  const sourceRegistry = await loadRegistryFile(options.catalog);
  const plugin = await loadRuntimePlugin(raw, sourceRegistry, options);
  return executeInstallPlan(plugin, sourceRegistry, options, 'install');
}

async function listPlugins(includeRemoved = false) {
  const registry = await readRuntimeRegistry();
  print(registry.plugins.filter((item) => includeRemoved || item.state !== 'removed').sort((a, b) => a.id.localeCompare(b.id)));
}

async function statusPlugin(id, includeRemoved = false) {
  const registry = await readRuntimeRegistry();
  if (!id) {
    return print(registry.plugins
      .filter((item) => includeRemoved || item.state !== 'removed')
      .map(({ id: pluginId, version, state, channel, enabled, activated, restart_required, health }) => ({ id: pluginId, version, state, channel, enabled, activated, restart_required, health: health?.status || null })));
  }
  const item = getRuntimePlugin(registry, id, { includeRemoved });
  if (!item) throw new Error('plugin is not installed: ' + id);
  print(item);
}

async function removePlugin(id) {
  const registry = await readRuntimeRegistry();
  const item = getRuntimePlugin(registry, id);
  if (!item) throw new Error('plugin is not installed: ' + id);
  const target = item.path || pluginPath(id);
  await removePath(target);
  await removePath(target + '.backup');
  const next = markRuntimePluginRemoved(registry, id, { path: target });
  await writeRuntimeRegistry(next);
  print({ id, removed: true, path: target, restart_required: true });
}

async function updatePlugin(id, version, options) {
  const runtime = await readRuntimeRegistry();
  const current = getRuntimePlugin(runtime, id);
  if (!current) throw new Error('plugin is not installed: ' + id);
  const sourceRegistry = await loadRegistryFile(options.catalog);
  const channel = options.channel || current.channel || 'stable';
  const plugin = resolvePlugin(sourceRegistry, id, version || '*', { channel });
  if (!options.forceRepair && current.version === plugin.version && current.commit === plugin.commit && await pathExists(current.path || pluginPath(id))) {
    return print({ id, version: current.version, commit: current.commit, up_to_date: true });
  }
  const installRoot = options.root || (current.path ? dirname(current.path) : undefined);
  const result = await executeInstallPlan(plugin, sourceRegistry, { ...options, root: installRoot, force: true }, options.forceRepair ? 'repair' : 'update');
  print({ ...result, updated: !options.forceRepair, repaired: Boolean(options.forceRepair) });
}

async function rollbackPlugin(id) {
  const registry = await readRuntimeRegistry();
  const item = getRuntimePlugin(registry, id);
  if (!item) throw new Error('plugin is not installed: ' + id);
  const target = item.path || pluginPath(id);
  const { lock } = await rollbackInstalledPath(target);
  const next = recordRuntimeEvent({
    ...item,
    version: lock.version,
    source: lock.source,
    commit: lock.source.commit,
    channel: lock.channel || item.channel || 'stable',
    state: 'installed',
    activated: false,
    restart_required: true,
    health: null,
    rollback: null,
    restored_at: new Date().toISOString(),
  }, 'rollback-complete', { version: lock.version, commit: lock.source.commit });
  await writeRuntimeRegistry(upsertRuntimePlugin(registry, next));
  print({ id, rolled_back: true, version: lock.version, commit: lock.source.commit, restart_required: true });
}

async function setPluginEnabled(id, enabled) {
  const registry = await readRuntimeRegistry();
  const item = getRuntimePlugin(registry, id);
  if (!item) throw new Error('plugin is not installed: ' + id);
  const next = enabled ? enablePlugin(item) : disablePlugin(item);
  await writeRuntimeRegistry(upsertRuntimePlugin(registry, next));
  print({ id, enabled: next.enabled, state: next.state, restart_required: true });
}

async function healthPlugins(id, options = {}) {
  const registry = await readRuntimeRegistry();
  const records = id ? [getRuntimePlugin(registry, id)].filter(Boolean) : registry.plugins.filter((item) => item.state !== 'removed');
  if (id && records.length === 0) throw new Error('plugin is not installed: ' + id);
  const results = [];
  let next = registry;
  for (const record of records) {
    const health = await checkRuntimeHealth(record, { runtimeRegistry: registry });
    results.push({ id: record.id, health });
    next = upsertRuntimePlugin(next, { ...record, health });
  }
  if (records.length) await writeRuntimeRegistry(next);
  const payload = { healthy: results.every((item) => item.health.status === 'healthy'), plugins: results };
  print(id ? results[0] : payload);
  if (!options.noExitCode && results.some((item) => item.health.status === 'failed')) process.exitCode = 1;
  return payload;
}

async function repairPlugin(id, options) {
  const registry = await readRuntimeRegistry();
  const current = getRuntimePlugin(registry, id);
  if (!current) throw new Error('plugin is not installed: ' + id);
  const health = await checkRuntimeHealth(current, { runtimeRegistry: registry });
  if (health.status === 'healthy') return print({ id, repaired: false, reason: 'healthy' });
  return updatePlugin(id, current.version, { ...options, channel: options.channel || current.channel, forceRepair: true });
}

async function historyPlugin(id) {
  const registry = await readRuntimeRegistry();
  const item = getRuntimePlugin(registry, id, { includeRemoved: true });
  if (!item) throw new Error('plugin has no runtime history: ' + id);
  print({ id, history: item.history || [] });
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

  if (command === 'plugin') {
    const action = process.argv[3] || 'list';
    const id = positional(4);
    if (action === 'list') return listPlugins(includeRemoved);
    if (action === 'status') return statusPlugin(id, includeRemoved);
    if (action === 'add' || action === 'install') return print(await installFromSpec(id, options));
    if (action === 'remove') return removePlugin(id);
    if (action === 'update') return updatePlugin(id, positional(5), options);
    if (action === 'rollback') return rollbackPlugin(id);
    if (action === 'health' || action === 'doctor') return healthPlugins(id);
    if (action === 'repair') return repairPlugin(id, options);
    if (action === 'enable') return setPluginEnabled(id, true);
    if (action === 'disable') return setPluginEnabled(id, false);
    if (action === 'history') return historyPlugin(id);
    throw new Error('unknown plugin action: ' + action);
  }

  if (command === 'check-registry') {
    const registry = await loadRegistryFile(catalog);
    const result = validateRegistry(registry);
    if (result.errors.length) throw new Error(result.errors.join('; '));
    if (registry.plugins.length) {
      const first = resolvePlugin(registry, registry.plugins[0].id, registry.plugins[0].version);
      const verification = verifyResolvedPlugin(first);
      if (!verification.ok) throw new Error(verification.errors.join('; '));
    }
    console.log('Runtime registry check passed: ' + registry.plugins.length + ' plugins');
    return;
  }

  if (command === 'resolve') {
    const registry = await loadRegistryFile(catalog);
    const spec = parsePluginSpec(process.argv[3], channel ? '*' : registry.defaults?.plugin_version);
    print(resolvePlugin(registry, spec.id, spec.version, { channel }));
    return;
  }

  if (command === 'install') {
    const result = await installFromSpec(process.argv[3], options);
    print(result);
    if (!dryRun) console.log('Install verified. Restart the client to activate the plugin.');
    return;
  }

  if (command === 'load') {
    const spec = parsePluginSpec(process.argv[3]);
    print(await loadInstalledPlugin(spec.id, { root, version: spec.version }));
    return;
  }

  if (command === 'lock') {
    const spec = parsePluginSpec(process.argv[3]);
    print(await readInstallLock(pluginPath(spec.id, root)));
    return;
  }

  throw new Error('unknown runtime command: ' + command);
}

main().catch((error) => {
  console.error('[runtime] ' + (error.stack || error.message));
  process.exit(1);
});
