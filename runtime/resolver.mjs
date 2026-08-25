#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compareVersions, satisfiesVersion } from './semver.mjs';

export function parsePluginSpec(spec, defaultVersion = '0.1.0') {
  const raw = String(spec || '').trim();
  if (!raw) throw new Error('plugin spec is required');
  const at = raw.lastIndexOf('@');
  if (at > 0) return { id: raw.slice(0, at), version: raw.slice(at + 1) || defaultVersion };
  return { id: raw, version: defaultVersion };
}

function releaseChannel(plugin) {
  return plugin.channel || plugin.release_channel || 'stable';
}

export function resolvePlugin(registry, id, version = registry?.defaults?.plugin_version || '0.1.0', options = {}) {
  if (registry?.registry_version !== 3) throw new Error('Registry V3 is required');
  const range = version || '*';
  const channel = options.channel || 'stable';
  const idKey = String(id || '').toLowerCase();
  const candidates = (registry.plugins || [])
    .filter((item) => String(item.id || '').toLowerCase() === idKey)
    .filter((item) => releaseChannel(item) === channel)
    .filter((item) => satisfiesVersion(item.version, range))
    .sort((a, b) => compareVersions(b.version, a.version));
  const plugin = candidates[0];
  if (!plugin) throw new Error(`Plugin not found: ${id}@${range} [${channel}]`);

  return {
    id: plugin.id,
    version: plugin.version,
    channel: releaseChannel(plugin),
    repo: plugin.source.repo,
    ref: plugin.source.ref,
    commit: plugin.source.commit,
    archive_url: plugin.source.archive_url,
    integrity: plugin.artifact.integrity,
    runtime: plugin.runtime,
    capabilities: plugin.capabilities || [],
    dependencies: plugin.dependencies || [],
    metadata: plugin.metadata || {},
    source: plugin.source,
    artifact: plugin.artifact,
  };
}

export function normalizeDependency(dependency) {
  if (typeof dependency === 'string') {
    const at = dependency.lastIndexOf('@');
    return at > 0
      ? { id: dependency.slice(0, at), range: dependency.slice(at + 1) || '*', optional: false }
      : { id: dependency, range: '*', optional: false };
  }
  if (!dependency?.id) throw new Error('dependency id is required');
  return {
    id: dependency.id,
    range: dependency.range || dependency.version || '*',
    optional: dependency.optional === true,
  };
}

export function buildDependencyPlan(registry, rootPlugin, options = {}) {
  const selected = new Map();
  const constraints = new Map();
  const graph = {};
  const order = [];
  const visiting = [];

  function visit(plugin, requestedRange = plugin.version) {
    const cycleIndex = visiting.indexOf(plugin.id);
    if (cycleIndex >= 0) throw new Error(`dependency cycle detected: ${[...visiting.slice(cycleIndex), plugin.id].join(' -> ')}`);

    const existing = selected.get(plugin.id);
    if (existing) {
      if (!satisfiesVersion(existing.version, requestedRange)) {
        throw new Error(`dependency conflict: ${plugin.id}@${existing.version} does not satisfy ${requestedRange}`);
      }
      return existing;
    }

    selected.set(plugin.id, plugin);
    constraints.set(plugin.id, requestedRange);
    visiting.push(plugin.id);
    graph[plugin.id] = [];

    for (const rawDependency of plugin.dependencies || []) {
      const dependency = normalizeDependency(rawDependency);
      let resolved;
      try {
        resolved = resolvePlugin(registry, dependency.id, dependency.range, { channel: options.channel || plugin.channel || 'stable' });
      } catch (error) {
        if (dependency.optional) continue;
        throw error;
      }
      const previousConstraint = constraints.get(resolved.id);
      if (previousConstraint && !satisfiesVersion(resolved.version, previousConstraint)) {
        throw new Error(`dependency conflict: ${dependency.id} cannot satisfy ${previousConstraint} and ${dependency.range}`);
      }
      graph[plugin.id].push({ id: dependency.id, range: dependency.range, version: resolved.version, optional: dependency.optional });
      visit(resolved, dependency.range);
    }

    visiting.pop();
    order.push(plugin);
    return plugin;
  }

  visit(rootPlugin);
  const installed = options.installed || [];
  const replacements = order
    .filter((plugin) => {
      const pluginKey = String(plugin.id || '').toLowerCase();
      const current = installed.find((item) => String(item.id || '').toLowerCase() === pluginKey && item.state !== 'removed');
      return current && (current.version !== plugin.version || current.commit !== plugin.commit);
    })
    .map((plugin) => plugin.id);
  return { root: rootPlugin.id, channel: options.channel || rootPlugin.channel || 'stable', order, graph, replacements };
}

export async function loadRegistryFile(file = 'catalog/registry-v3.json') {
  return JSON.parse(await readFile(resolve(process.cwd(), file), 'utf8'));
}
