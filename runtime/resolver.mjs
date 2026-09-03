import { readFile } from 'node:fs/promises';
import { ensureRegistryCache, resolveRegistrySource } from './catalog.mjs';
import { compareVersions, satisfiesVersion } from './semver.mjs';
import { resolveConfiguredRegistryReference } from './registry-manager.mjs';
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

function activeAdvisories(item) {
  const values = item?.security?.advisories || item?.advisories || [];
  return (Array.isArray(values) ? values : [])
    .filter((advisory) => advisory && advisory.withdrawn !== true && advisory.resolved !== true)
    .map((advisory) => ({
      id: advisory.id || advisory.cve || advisory.ghsa || 'unknown',
      severity: String(advisory.severity || 'unknown').toLowerCase(),
      title: advisory.title || advisory.summary || null,
    }));
}

function blockedSecurity(item, options = {}) {
  if (item?.security?.revoked === true || item?.security?.recalled === true) {
    return { code: 'DSH_PACKAGE_REVOKED', reason: 'revoked' };
  }
  if (item?.security?.yanked === true && options.allowYanked !== true) {
    return { code: 'DSH_PACKAGE_YANKED', reason: 'yanked' };
  }
  const advisories = activeAdvisories(item);
  const blocking = advisories.filter((advisory) => advisory.severity === 'critical' || advisory.severity === 'high');
  if (blocking.length && options.allowVulnerable !== true) {
    return { code: 'DSH_SECURITY_ADVISORY_BLOCKED', reason: 'security-advisory', advisories: blocking };
  }
  return null;
}

function selectionError(block, type, id, range, channel) {
  const suffix = `${type}:${id}@${range} [${channel}]`;
  const message = block.code === 'DSH_PACKAGE_REVOKED'
    ? `Runtime package is revoked and cannot be selected: ${suffix}`
    : block.code === 'DSH_PACKAGE_YANKED'
      ? `Runtime package is yanked and cannot be selected: ${suffix}`
      : `Runtime package is blocked by a high/critical security advisory: ${suffix}`;
  const error = new Error(message);
  error.code = block.code;
  if (block.advisories) error.advisories = block.advisories;
  return error;
}

function selectAllowed(candidates, options, type, id, range, channel) {
  const allowed = [];
  const blocked = [];
  for (const candidate of candidates) {
    const block = blockedSecurity(candidate, options);
    if (block) blocked.push({ candidate, block });
    else allowed.push(candidate);
  }
  if (!allowed.length && blocked.length) {
    const revoked = blocked.find((item) => item.block.code === 'DSH_PACKAGE_REVOKED');
    const advisory = blocked.find((item) => item.block.code === 'DSH_SECURITY_ADVISORY_BLOCKED');
    const chosen = revoked || advisory || blocked[0];
    throw selectionError(chosen.block, type, id, range, channel);
  }
  return allowed;
}

export function resolvePackage(registry, type, id, version, options = {}) {
  if (registry?.registry_version !== 3) throw new Error('Registry V3 is required');
  const normalizedType = assertPackageType(type);
  const range = version || defaultRegistryVersion(registry, normalizedType) || '*';
  const channel = options.channel || 'stable';
  const idKey = String(id || '').toLowerCase();
  const typeChannel = (registry.plugins || [])
    .filter((item) => inferPackageType(item) === normalizedType)
    .filter((item) => releaseChannel(item) === channel);
  const matching = typeChannel.filter((item) => satisfiesVersion(item.version, range));

  const directIdentity = typeChannel.filter((item) => String(item.id || '').toLowerCase() === idKey);
  const directMatching = matching.filter((item) => String(item.id || '').toLowerCase() === idKey);
  let candidates;
  if (directMatching.length) {
    candidates = selectAllowed(directMatching, options, normalizedType, id, range, channel);
  } else {
    const providerIdentity = typeChannel.filter((item) => matchesCapability(item, idKey));
    const providerMatching = matching.filter((item) => matchesCapability(item, idKey));
    if (providerMatching.length) candidates = selectAllowed(providerMatching, options, normalizedType, id, range, channel);
    else {
      const identityExists = directIdentity.length > 0 || providerIdentity.length > 0;
      const error = new Error(identityExists
        ? `Runtime package version not found: ${normalizedType}:${id}@${range} [${channel}]`
        : `Runtime package not found: ${normalizedType}:${id}@${range} [${channel}]`);
      error.code = identityExists ? 'DSH_VERSION_NOT_FOUND' : 'DSH_PACKAGE_NOT_FOUND';
      throw error;
    }
  }

  candidates.sort((a, b) => compareVersions(b.version, a.version));
  const pkg = candidates[0];
  if (!pkg) {
    const error = new Error(`Runtime package not found: ${normalizedType}:${id}@${range} [${channel}]`);
    error.code = 'DSH_PACKAGE_NOT_FOUND';
    throw error;
  }

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
    permission_policy: pkg.permission_policy || null,
    compatibility: pkg.compatibility || {},
    publisher: pkg.publisher || null,
    security: pkg.security || null,
    advisories: activeAdvisories(pkg),
    conflicts: pkg.conflicts || [],
    replaces: pkg.replaces || [],
    provides: pkg.provides || [],
    type_config: pkg.type_config || null,
    metadata: pkg.metadata || {},
    source: pkg.source,
    artifact: pkg.artifact,
    registry_sources: pkg.registry_sources || [],
    release_tag: pkg.release_tag || pkg.artifact?.release_tag || null,
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
      const error = new Error(`dependency cycle detected: ${[...visiting.slice(cycleIndex), key].join(' -> ')}`);
      error.code = 'DSH_DEPENDENCY_CYCLE';
      throw error;
    }

    const existing = selected.get(key);
    if (existing) {
      if (!satisfiesVersion(existing.version, requestedRange)) {
        const error = new Error(`dependency conflict: ${key}@${existing.version} does not satisfy ${requestedRange}`);
        error.code = 'DSH_DEPENDENCY_CONFLICT';
        throw error;
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
          allowYanked: options.allowYanked === true,
          allowVulnerable: options.allowVulnerable === true,
        });
      } catch (error) {
        if (dependency.optional) continue;
        throw error;
      }
      const dependencyKey = packageKey(resolved.type, resolved.id);
      const previousConstraint = constraints.get(dependencyKey);
      if (previousConstraint && !satisfiesVersion(resolved.version, previousConstraint)) {
        const error = new Error(`dependency conflict: ${dependencyKey} cannot satisfy ${previousConstraint} and ${dependency.range}`);
        error.code = 'DSH_DEPENDENCY_CONFLICT';
        throw error;
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
        const error = new Error(`package conflict: ${packageKey(pkg.type || 'plugin', pkg.id)} conflicts with ${conflict}`);
        error.code = 'DSH_DEPENDENCY_CONFLICT';
        throw error;
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
    constraints: Object.fromEntries(constraints.entries()),
    replacements,
    declared_replacements,
  };
}

async function readRegistrySourceFile(source) {
  const file = await ensureRegistryCache(source);
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function loadRegistryFile(file = 'catalog/registry-v3.json') {
  const configured = await resolveConfiguredRegistryReference(file);
  if (configured) return configured;
  try {
    const source = await resolveRegistrySource(file);
    return await readRegistrySourceFile(source);
  } catch (error) {
    if (error?.code !== 'ENOENT' || file !== 'catalog/registry-v3.json') throw error;
    const fallback = await resolveRegistrySource();
    return readRegistrySourceFile(fallback);
  }
}
