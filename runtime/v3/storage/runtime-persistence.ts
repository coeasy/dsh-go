export interface RuntimePackageRecord {
  id: string;
  type: 'plugin' | 'mcp' | 'skill' | 'agent';
  version: string;
  state: 'installed' | 'enabled' | 'disabled' | 'failed';
  path?: string;
}

export interface RuntimeRegistryState {
  schemaVersion: number;
  packages: RuntimePackageRecord[];
}

export function createRuntimeRegistry(): RuntimeRegistryState {
  return {
    schemaVersion: 1,
    packages: [],
  };
}

export function upsertRuntimePackage(
  registry: RuntimeRegistryState,
  item: RuntimePackageRecord,
): RuntimeRegistryState {
  const packages = registry.packages.filter((pkg) => pkg.id !== item.id);
  return {
    ...registry,
    packages: [...packages, item],
  };
}

export function removeRuntimePackage(
  registry: RuntimeRegistryState,
  id: string,
): RuntimeRegistryState {
  return {
    ...registry,
    packages: registry.packages.filter((pkg) => pkg.id !== id),
  };
}
