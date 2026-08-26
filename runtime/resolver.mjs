import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compareVersions, satisfiesVersion } from './semver.mjs';
import {
  assertPackageType,
  inferPackageType,
  normalizePackageDependency,
  packageKey,
  parsePackageSpec,
} from './package-model.mjs';

export function parsePluginSpec(spec, defaultVersion = '0.1.0') {
  const parsed = parsePackageSpec(spec, defaultVersion, 'plugin');
  return { id: parsed.id, version: parsed.version };
}

function releaseChannel(pkg) {
  return pkg.channel || pkg.release_channel || 'stable';
}

function defaultRegistryVersion(registry, type) {
  return registry?.defaults?.[`${type}_version`] || registry?.defaults?.plugin_version || '0.1.0';
}

function matchesCapability(item, token) {
  const key = String(token || '').toLowerCase();
  return (item.provides || []).some((capability) => String(capability).toLowerCase() === key);
}

export function resolvePackage(registry, type, id, version, options = {}) {
  if (registry?.registry_version !== 3) throw new Error('Registry V3 is required');
  const normalizedType = assertPackageType(type);
  const range = version || defaultRegistryVersion(registry, normalizedType) || '*';
  const channel = options.channel || 'stable';
  const idKey = String(id || '').toLowerCase();
  const eligible = (registry.plugins || [])
    .filter((item) => inferPackageType(item) === normalizedType)
    .filter((item) => releaseChannel(item) === channel)
    .filter((item) => satisfiesVersion(item.version, range));
  const directCandidates = eligible.filter((item) => String(item.id || '').toLowerCase() === idKey);
  const providerCandidates = directCandidates.length ? [] : eligible.filter((item) => matchesCapability(item, idKey));
  const candidates = [...directCandidates, ...providerCandidates]
    .sort((a, b) => compareVersions(b.version, a.version));
  const pkg = candidates[0];
  if (!pkg) throw new Error(`Runtime package not found: ${normalizedType}:${id}@${range} [${channel}]`);

  return {
    id: pkg.id,
    type: normalizedType,
    version: pkg.version,
    channel: releaseChannel(pkg),
    repo: pkg.source.repo,
    ref: pkg.source.ref,
    commit: pkg.source.commit,
    archive_url: pkg.source.archive_url,
    integrity: pkg.artifact.integrity,
    runtime: pkg.runtime,
    capabilities: pkg.capabilities || [],
    dependencies: pkg.dependencies || [],
    permissions: pkg.permissions || [],
    compatibility: pkg.compatibility || {},
    publisher: pkg.publisher || null,
    security: pkg.security || null,
    conflicts: pkg.conflicts || [],
    replaces: pkg.replaces || [],
    provides: pkg.provides || [],
    type_config: pkg.type_config || null,
    metadata: pkg.metadata || {},
    source: pkg.source,
    artifact: pkg.artifact,
  };
}

export function resolvePlugin(registry, id, version = registry?.defaults?.plugin_version || '0.1.0', options = {}) {
  return resolvePackage(registry, 'plugin', id, version, options);
}

export function normalizeDependency(dependency, defaultType = 'plugin') {
  return normalizePackageDependency(dependency, defaultType);
}

function graphKey(pkg) {
  return pkg.type === 'plugin' ? pkg.id : packageKey(pkg.type, pkg.id);
}

function resolveDependency(registry, dependency, options) {
  return resolvePackage(registry, dependency.type, dependency.id, dependency.range, options);
}

function recordMatchesToken(item, token) {
  return String(item.id || '').toLowerCase() === String(token || '').toLowerCase()
    || matchesCapability(item, token);
}

export function buildDependencyPlan(registry, rootPackage, options = {}) {
  const selected = new Map();
  const constraints = new Map();
  const graph = {};
  const order = [];
  const visiting = [];

  function visit(pkg, requestedRange = pkg.version) {
    const key = packageKey(pkg.type || 'plugin', pkg.id);
    const cycleIndex = visiting.indexOf(key);
    if (cycleIndex >= 0) {
      throw new Error(`dependency cycle detected: ${[...visiting.slice(cycleIndex), key].join(' -> ')}`);
    }

    const existing = selected.get(key);
    if (existing) {
      if (!satisfiesVersion(existing.version, requestedRange)) {
        throw new Error(`dependency conflict: ${key}@${existing.version} does not satisfy ${requestedRange}`);
      }
      return existing;
    }

    selected.set(key, pkg);
    constraints.set(key, requestedRange);
    visiting.push(key);
    const outputKey = graphKey(pkg);
    graph[outputKey] = [];

    for (const rawDependency of pkg.dependencies || []) {
      const dependency = normalizeDependency(rawDependency, 'plugin');
      let resolved;
      try {
        resolved = resolveDependency(registry, dependency, {
          channel: options.channel || pkg.channel || 'stable',
        });
      } catch (error) {
        if (dependency.optional) continue;
        throw error;
      }
      const dependencyKey = packageKey(resolved.type, resolved.id);
      const previousConstraint = constraints.get(dependencyKey);
      if (previousConstraint && !satisfiesVersion(resolved.version, previousConstraint)) {
        throw new Error(`dependency conflict: ${dependencyKey} cannot satisfy ${previousConstraint} and ${dependency.range}`);
      }
      graph[outputKey].push({
        type: resolved.type,
        id: dependency.id,
        range: dependency.range,
        version: resolved.version,
        optional: dependency.optional,
      });
      visit(resolved, dependency.range);
    }

    visiting.pop();
    order.push(pkg);
    return pkg;
  }

  visit({ ...rootPackage, type: assertPackageType(rootPackage.type || 'plugin') });
  const installed = options.installed || [];
  const activeInstalled = installed.filter((item) => item.state !== 'removed');

  for (const pkg of order) {
    for (const conflict of pkg.conflicts || []) {
      const selectedConflict = order.find((candidate) =>
        packageKey(candidate.type || 'plugin', candidate.id) !== packageKey(pkg.type || 'plugin', pkg.id)
        && recordMatchesToken(candidate, conflict));
      const installedConflict = activeInstalled.find((candidate) =>
        packageKey(candidate.type || 'plugin', candidate.id) !== packageKey(pkg.type || 'plugin', pkg.id)
        && recordMatchesToken(candidate, conflict));
      if (selectedConflict || installedConflict) {
        throw new Error(`package conflict: ${packageKey(pkg.type || 'plugin', pkg.id)} conflicts with ${conflict}`);
      }
    }
  }

  const replacements = order
    .filter((pkg) => {
      const key = packageKey(pkg.type, pkg.id);
      const current = installed.find((item) => packageKey(item.type || 'plugin', item.id) === key && item.state !== 'removed');
      return current && (current.version !== pkg.version || current.commit !== pkg.commit);
    })
    .map((pkg) => pkg.type === 'plugin' ? pkg.id : packageKey(pkg.type, pkg.id));
  const declared_replacements = [...new Set(order.flatMap((pkg) => pkg.replaces || []))];

  return {
    root: rootPackage.type === 'plugin' || !rootPackage.type ? rootPackage.id : packageKey(rootPackage.type, rootPackage.id),
    root_type: assertPackageType(rootPackage.type || 'plugin'),
    channel: options.channel || rootPackage.channel || 'stable',
    order,
    graph,
    replacements,
    declared_replacements,
  };
}

export async function loadRegistryFile(file = 'catalog/registry-v3.json') {
  return JSON.parse(await readFile(resolve(process.cwd(), file), 'utf8'));
}
