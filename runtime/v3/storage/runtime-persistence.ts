import type { RuntimeRecord } from './persistence';

export type RuntimePackageRecord = RuntimeRecord;

export interface RuntimeRegistryState {
  schemaVersion: 2;
  packages: RuntimePackageRecord[];
}

export function createRuntimeRegistry(packages: RuntimePackageRecord[] = []): RuntimeRegistryState {
  return { schemaVersion: 2, packages: [...packages] };
}

export function upsertRuntimePackage(registry: RuntimeRegistryState, item: RuntimePackageRecord): RuntimeRegistryState {
  const packages = registry.packages.filter((pkg) => pkg.id !== item.id);
  return { ...registry, packages: [...packages, item] };
}

export function removeRuntimePackage(registry: RuntimeRegistryState, id: string): RuntimeRegistryState {
  return { ...registry, packages: registry.packages.filter((pkg) => pkg.id !== id) };
}
