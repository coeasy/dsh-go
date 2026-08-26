import { normalizePackageDependency, packageKey } from './package-model.mjs';
import {
  getRuntimePackage,
  markRuntimePackageRemoved,
  packagePath,
  readRuntimeRegistry,
  removePath,
  writeRuntimeRegistry,
} from './registry.mjs';

function dependencyKey(dependency) {
  try {
    const normalized = normalizePackageDependency(dependency, 'plugin');
    return packageKey(normalized.type, normalized.id);
  } catch {
    return null;
  }
}

export function findRuntimeDependents(registry, type, id) {
  const key = packageKey(type, id);
  return (registry.packages || [])
    .filter((record) => record.state !== 'removed')
    .filter((record) => packageKey(record.type || 'plugin', record.id) !== key)
    .filter((record) => (record.dependencies || []).some((dependency) => dependencyKey(dependency) === key))
    .map((record) => ({
      id: record.id,
      type: record.type || 'plugin',
      key: packageKey(record.type || 'plugin', record.id),
      version: record.version,
      state: record.state,
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function removalOrder(registry, type, id, stack = [], seen = new Set()) {
  const key = packageKey(type, id);
  if (stack.includes(key)) throw new Error(`runtime dependency cycle while removing: ${[...stack, key].join(' -> ')}`);
  if (seen.has(key)) return [];
  const dependents = findRuntimeDependents(registry, type, id);
  const order = [];
  for (const dependent of dependents) {
    order.push(...removalOrder(registry, dependent.type, dependent.id, [...stack, key], seen));
  }
  seen.add(key);
  order.push({ type, id, key });
  return order;
}

export async function planRuntimeRemoval(type, id, options = {}) {
  const registry = options.registry || await readRuntimeRegistry(options.registryFile);
  const item = getRuntimePackage(registry, type, id);
  if (!item) throw new Error(`runtime package is not installed: ${packageKey(type, id)}`);
  const dependents = findRuntimeDependents(registry, type, id);
  if (dependents.length && !options.cascade) {
    const error = new Error(`cannot remove ${packageKey(type, id)}; required by ${dependents.map((item) => item.key).join(', ')} (use --cascade to remove dependents first)`);
    error.code = 'DSH_PACKAGE_IN_USE';
    error.dependents = dependents;
    throw error;
  }
  const order = options.cascade ? removalOrder(registry, type, id) : [{ type, id, key: packageKey(type, id) }];
  return { root: packageKey(type, id), cascade: options.cascade === true, dependents, order };
}

export async function removeRuntimePackageSafe(type, id, options = {}) {
  const registryFile = options.registryFile;
  let registry = await readRuntimeRegistry(registryFile);
  const plan = await planRuntimeRemoval(type, id, { ...options, registry });
  if (options.dryRun) return { ...plan, dry_run: true, restart_required: false };

  const removed = [];
  for (const candidate of plan.order) {
    const item = getRuntimePackage(registry, candidate.type, candidate.id);
    if (!item) continue;
    const target = item.path || packagePath(candidate.type, candidate.id);
    await removePath(target);
    await removePath(`${target}.backup`);
    registry = markRuntimePackageRemoved(registry, candidate.type, candidate.id, {
      path: target,
      cascade_root: plan.root,
    });
    removed.push({ ...candidate, path: target });
  }
  await writeRuntimeRegistry(registry, registryFile);
  return { ...plan, removed, restart_required: true };
}
