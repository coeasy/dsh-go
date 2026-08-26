import type { RuntimeRecord, RuntimePackageType } from './persistence';

export type RuntimePackageRecord = RuntimeRecord;

export interface RuntimeRegistryState {
  schemaVersion: 3;
  packages: RuntimePackageRecord[];
}

function key(item: Pick<RuntimePackageRecord, 'id' | 'type'>): string {
  return `${item.type}:${item.id.toLowerCase()}`;
}

export function createRuntimeRegistry(packages: RuntimePackageRecord[] = []): RuntimeRegistryState {
  return { schemaVersion: 3, packages: [...packages] };
}

export function upsertRuntimePackage(registry: RuntimeRegistryState, item: RuntimePackageRecord): RuntimeRegistryState {
  const itemKey = key(item);
  const packages = registry.packages.filter((pkg) => key(pkg) !== itemKey);
  return { ...registry, packages: [...packages, item] };
}

export function removeRuntimePackage(registry: RuntimeRegistryState, id: string, type: RuntimePackageType = 'plugin'): RuntimeRegistryState {
  const itemKey = `${type}:${id.toLowerCase()}`;
  return { ...registry, packages: registry.packages.filter((pkg) => key(pkg) !== itemKey) };
}
