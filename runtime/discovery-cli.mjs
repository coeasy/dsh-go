import { loadRegistryFile, resolvePackage } from './resolver.mjs';
import { compareVersions } from './semver.mjs';
import { assertPackageType, inferPackageType, packageKey, parsePackageRequest } from './package-model.mjs';
import { readRuntimeRegistry } from './registry.mjs';
import { printCliValue } from './cli-output.mjs';
import { dependencyGraphFromExplanation, explainPackageResolution } from './solver-explain.mjs';

const PACKAGE_TYPES = new Set(['plugin', 'mcp', 'skill', 'agent']);
const DISCOVERY_ACTIONS = new Set(['search', 'info', 'outdated', 'graph', 'explain']);

function option(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function positional(args, index) {
  const value = args[index];
  return value && !value.startsWith('--') ? value : undefined;
}

function releaseChannel(item) {
  return item.channel || item.release_channel || 'stable';
}

function searchableText(item) {
  const metadata = item.metadata || {};
  const tags = Array.isArray(metadata.tags) ? metadata.tags : Array.isArray(item.tags) ? item.tags : [];
  return [
    item.id,
    item.source?.repo,
    metadata.name,
    metadata.display_name,
    metadata.summary,
    metadata.description,
    ...tags,
    ...(item.capabilities || []),
    ...(item.provides || []),
  ].filter(Boolean).join(' ').toLowerCase();
}

function compactPackage(item) {
  const type = inferPackageType(item);
  return {
    id: item.id,
    type,
    key: packageKey(type, item.id),
    version: item.version,
    channel: releaseChannel(item),
    repo: item.source?.repo || null,
    updated_at: item.source?.updated_at || null,
    capabilities: item.capabilities || [],
    permissions: item.permissions || [],
    publisher: item.publisher || null,
    security: item.security || null,
    metadata: item.metadata || {},
  };
}

export function latestSearchablePackages(registry, options = {}) {
  const requestedType = options.type ? assertPackageType(options.type) : null;
  const channel = options.channel || 'stable';
  const latest = new Map();

  for (const item of registry.plugins || []) {
    const type = inferPackageType(item);
    if (requestedType && type !== requestedType) continue;
    if (releaseChannel(item) !== channel) continue;
    if (item.security?.yanked === true || item.security?.revoked === true || item.security?.recalled === true) continue;
    const key = packageKey(type, item.id);
    const current = latest.get(key);
    if (!current || compareVersions(item.version, current.version) > 0) latest.set(key, item);
  }

  return [...latest.values()];
}

export function searchPackages(registry, query, options = {}) {
  const needle = String(query || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(Number(options.limit || 20), 100));
  const items = latestSearchablePackages(registry, options)
    .filter((item) => !needle || searchableText(item).includes(needle))
    .sort((a, b) => {
      const aId = String(a.id || '').toLowerCase();
      const bId = String(b.id || '').toLowerCase();
      const aExact = needle && aId === needle ? 1 : 0;
      const bExact = needle && bId === needle ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      const updated = Date.parse(b.source?.updated_at || '') - Date.parse(a.source?.updated_at || '');
      if (Number.isFinite(updated) && updated !== 0) return updated;
      return aId.localeCompare(bId);
    })
    .slice(0, limit)
    .map(compactPackage);

  return { query: needle, type: options.type || null, channel: options.channel || 'stable', count: items.length, packages: items };
}

function resolveByIdOrRepo(registry, type, raw, version = '*', channel = 'stable') {
  const parsed = parsePackageRequest(raw, { defaultVersion: version, defaultType: type, channel });
  try {
    return resolvePackage(registry, parsed.type, parsed.id, parsed.versionRange, { channel: parsed.channel });
  } catch (error) {
    const match = (registry.plugins || []).find((item) =>
      inferPackageType(item) === parsed.type
      && item.source?.repo === parsed.id
      && releaseChannel(item) === parsed.channel
      && item.security?.yanked !== true
      && item.security?.revoked !== true
      && item.security?.recalled !== true);
    if (!match) throw error;
    return resolvePackage(registry, parsed.type, match.id, parsed.versionRange, { channel: parsed.channel });
  }
}

export function packageInfo(registry, type, raw, options = {}) {
  const channel = options.channel || 'stable';
  const pkg = resolveByIdOrRepo(registry, type, raw, '*', channel);
  return {
    ...pkg,
    key: packageKey(pkg.type, pkg.id),
    install_command: `dsh ${pkg.type} install ${pkg.id}@${pkg.version}`,
  };
}

export function computeOutdated(registry, runtimeRegistry, options = {}) {
  const requestedType = options.type ? assertPackageType(options.type) : null;
  const rows = [];

  for (const current of runtimeRegistry.packages || []) {
    if (current.state === 'removed') continue;
    const currentType = assertPackageType(current.type || 'plugin');
    if (requestedType && currentType !== requestedType) continue;
    const channel = current.channel || 'stable';
    try {
      const latest = resolvePackage(registry, currentType, current.id, '*', { channel });
      const outdated = current.version !== latest.version || current.commit !== latest.commit;
      rows.push({
        id: current.id,
        type: currentType,
        key: packageKey(currentType, current.id),
        channel,
        current_version: current.version,
        latest_version: latest.version,
        current_commit: current.commit || null,
        latest_commit: latest.commit || null,
        outdated,
        status: outdated ? 'outdated' : 'current',
      });
    } catch (error) {
      rows.push({
        id: current.id,
        type: currentType,
        key: packageKey(currentType, current.id),
        channel,
        current_version: current.version,
        latest_version: null,
        current_commit: current.commit || null,
        latest_commit: null,
        outdated: false,
        status: 'unavailable',
        reason: error.message,
      });
    }
  }

  rows.sort((a, b) => a.key.localeCompare(b.key));
  return {
    type: requestedType,
    count: rows.length,
    outdated_count: rows.filter((item) => item.outdated).length,
    packages: rows,
  };
}

function discoveryType(args) {
  if (PACKAGE_TYPES.has(args[0])) return args[0];
  if (args[0] !== 'package') return null;
  const requested = option(args, '--type');
  return requested ? assertPackageType(requested) : null;
}

export async function runDiscoveryCli(args = process.argv.slice(2)) {
  const command = args[0];
  const type = discoveryType(args);
  const action = args[1];
  const catalog = option(args, '--registry', 'catalog/registry-v3.json');
  const channel = option(args, '--channel', 'stable');
  const registry = await loadRegistryFile(catalog);

  if (action === 'search') {
    const result = searchPackages(registry, positional(args, 2) || '', {
      type,
      channel,
      limit: option(args, '--limit', 20),
    });
    printCliValue(result, { argv: args });
    return result;
  }

  if (action === 'info') {
    const raw = positional(args, 2);
    if (!raw) throw new Error(`runtime package id is required for ${command} info`);
    const parsed = parsePackageRequest(raw, { defaultVersion: '*', defaultType: type || 'plugin', channel, registry: catalog });
    const result = packageInfo(registry, parsed.type, raw, { channel: parsed.channel });
    printCliValue(result, { argv: args });
    return result;
  }

  if (action === 'outdated') {
    const runtimeRegistry = await readRuntimeRegistry(option(args, '--runtime-registry'));
    const result = computeOutdated(registry, runtimeRegistry, { type });
    printCliValue(result, { argv: args });
    return result;
  }

  if (action === 'graph' || action === 'explain') {
    const raw = positional(args, 2);
    if (!raw) throw new Error(`runtime package id is required for ${command} ${action}`);
    const runtimeRegistry = await readRuntimeRegistry(option(args, '--runtime-registry'));
    const explanation = explainPackageResolution(registry, raw, {
      type: type || 'plugin',
      channel,
      registry: catalog,
      installed: runtimeRegistry.packages,
    });
    const result = action === 'graph' ? dependencyGraphFromExplanation(explanation) : explanation;
    printCliValue(result, { argv: args });
    return result;
  }

  throw new Error(`unsupported discovery action: ${command} ${action || '<empty>'}`);
}

export function isDiscoveryCommand(args = process.argv.slice(2)) {
  return (PACKAGE_TYPES.has(args[0]) || args[0] === 'package') && DISCOVERY_ACTIONS.has(args[1]);
}
