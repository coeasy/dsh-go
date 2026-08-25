#!/usr/bin/env node
import { access, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { installPlugin } from './installer.mjs';
import { loadInstalledPlugin } from './loader.mjs';
import { loadRegistryFile, parsePluginSpec, resolvePlugin } from './resolver.mjs';
import { readInstallLock, verifyInstalledCommit, verifyResolvedPlugin } from './verifier.mjs';
import { validateRegistry } from '../scripts/validate-registry-v3.mjs';
import {
  pathExists,
  pluginPath,
  readRuntimeRegistry,
  removePath,
  writeRuntimeRegistry,
} from './registry.mjs';

function option(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function loadRuntimePlugin(raw, registry) {
  const input = String(raw || '').replace(/^github:/, '');
  const parsed = parsePluginSpec(input, registry.defaults?.plugin_version);
  try {
    return resolvePlugin(registry, parsed.id, parsed.version);
  } catch (error) {
    const at = input.lastIndexOf('@');
    const repo = at > 0 ? input.slice(0, at) : input;
    const version = at > 0 ? input.slice(at + 1) : registry.defaults?.plugin_version || '0.1.0';
    const match = (registry.plugins || []).find((item) => item.version === version && item.source?.repo === repo);
    if (!match) throw error;
    return resolvePlugin(registry, match.id, match.version);
  }
}

function recordFor(plugin, result) {
  return {
    id: plugin.id,
    type: 'plugin',
    version: plugin.version,
    state: 'installed',
    path: result.target,
    source: plugin.source,
    commit: plugin.commit,
    dependencies: plugin.dependencies || [],
    installed_at: new Date().toISOString(),
    restart_required: true,
  };
}

async function persistInstall(plugin, result) {
  const registry = await readRuntimeRegistry();
  const plugins = registry.plugins.filter((item) => item.id !== plugin.id);
  return writeRuntimeRegistry({ ...registry, plugins: [...plugins, recordFor(plugin, result)] });
}

async function installResolved(plugin, sourceRegistry, options, visiting = new Set()) {
  if (visiting.has(plugin.id)) throw new Error('dependency cycle detected at ' + plugin.id);
  visiting.add(plugin.id);
  for (const dependency of plugin.dependencies || []) {
    const dependencyId = typeof dependency === 'string' ? dependency : dependency.id;
    const dependencyPlugin = await loadRuntimePlugin(dependencyId, sourceRegistry);
    await installResolved(dependencyPlugin, sourceRegistry, options, visiting);
  }
  visiting.delete(plugin.id);
  const result = await installPlugin(plugin, {
    root: options.root,
    force: options.force,
    dryRun: options.dryRun,
  });
  if (!options.dryRun) await persistInstall(plugin, result);
  return result;
}

async function installFromSpec(raw, options) {
  const sourceRegistry = await loadRegistryFile(options.catalog);
  const plugin = await loadRuntimePlugin(raw, sourceRegistry);
  return installResolved(plugin, sourceRegistry, options);
}

async function listPlugins() {
  const registry = await readRuntimeRegistry();
  print(registry.plugins);
}

async function removePlugin(id) {
  const registry = await readRuntimeRegistry();
  const item = registry.plugins.find((entry) => entry.id === id);
  if (!item) throw new Error('plugin is not installed: ' + id);
  const target = item.path || pluginPath(id);
  await removePath(target);
  await removePath(target + '.backup');
  await writeRuntimeRegistry({ ...registry, plugins: registry.plugins.filter((entry) => entry.id !== id) });
  print({ id, removed: true, path: target });
}

async function updatePlugin(id, version, options) {
  const registry = await readRuntimeRegistry();
  const current = registry.plugins.find((entry) => entry.id === id);
  if (!current) throw new Error('plugin is not installed: ' + id);
  const sourceRegistry = await loadRegistryFile(options.catalog);
  const targetVersion = version || current.version;
  const plugin = resolvePlugin(sourceRegistry, id, targetVersion);
  const result = await installResolved(plugin, sourceRegistry, { ...options, force: true });
  print({ ...result, updated: true, rollbackAvailable: await pathExists(result.backup) });
}

async function rollbackPlugin(id) {
  const registry = await readRuntimeRegistry();
  const item = registry.plugins.find((entry) => entry.id === id);
  if (!item) throw new Error('plugin is not installed: ' + id);
  const target = item.path || pluginPath(id);
  const backup = target + '.backup';
  await access(backup);
  const failed = target + '.failed-' + Date.now();
  await rename(target, failed);
  await rename(backup, target);
  const lock = await readInstallLock(target);
  const next = { ...item, version: lock.version, source: lock.source, commit: lock.source.commit, state: 'installed', restored_at: new Date().toISOString() };
  await writeRuntimeRegistry({ ...registry, plugins: registry.plugins.map((entry) => entry.id === id ? next : entry) });
  await rm(failed, { recursive: true, force: true });
  print({ id, rolledBack: true, version: lock.version });
}

async function doctor() {
  const registry = await readRuntimeRegistry();
  const results = [];
  for (const item of registry.plugins) {
    const target = item.path || pluginPath(item.id);
    const checks = [];
    try {
      const lock = await readInstallLock(target);
      checks.push('lock');
      await verifyInstalledCommit(target, lock.source.commit);
      checks.push('commit');
      results.push({ id: item.id, healthy: true, checks });
    } catch (error) {
      results.push({ id: item.id, healthy: false, checks, error: error.message });
    }
  }
  print({ healthy: results.every((item) => item.healthy), plugins: results });
  if (results.some((item) => !item.healthy)) process.exitCode = 1;
}

async function main() {
  const command = process.argv[2] || 'check-registry';
  const catalog = option('--registry', 'catalog/registry-v3.json');
  const root = option('--root');
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');
  const options = { catalog, root, dryRun, force };

  if (command === 'plugin') {
    const action = process.argv[3] || 'list';
    if (action === 'list') return listPlugins();
    if (action === 'add' || action === 'install') return print(await installFromSpec(process.argv[4], options));
    if (action === 'remove') return removePlugin(process.argv[4]);
    if (action === 'update') return updatePlugin(process.argv[4], process.argv[5], options);
    if (action === 'rollback') return rollbackPlugin(process.argv[4]);
    if (action === 'doctor') return doctor();
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
    const spec = parsePluginSpec(process.argv[3], registry.defaults?.plugin_version);
    print(resolvePlugin(registry, spec.id, spec.version));
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

  throw new Error('unknown runtime command: ' + command);
}

main().catch((error) => {
  console.error('[runtime] ' + (error.stack || error.message));
  process.exit(1);
});
