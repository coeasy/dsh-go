import {
  removeFromRegistry,
  upsertRegistry,
  type RuntimePackageType,
  type RuntimeRegistry,
} from '../storage/persistence';

export function listPackages(registry: RuntimeRegistry, type?: RuntimePackageType) {
  return registry.items.filter((item) => !type || item.type === type);
}

export function removePackage(registry: RuntimeRegistry, type: RuntimePackageType, id: string): RuntimeRegistry {
  return removeFromRegistry(registry, id, type);
}

export function updatePackage(
  registry: RuntimeRegistry,
  type: RuntimePackageType,
  id: string,
  version: string,
): RuntimeRegistry {
  return upsertRegistry(registry, {
    id,
    type,
    version,
    state: 'installed',
    restartRequired: true,
  });
}

export function listPlugins(registry: RuntimeRegistry) {
  return listPackages(registry, 'plugin');
}

export function removePlugin(registry: RuntimeRegistry, id: string): RuntimeRegistry {
  return removePackage(registry, 'plugin', id);
}

export function updatePlugin(registry: RuntimeRegistry, id: string, version: string): RuntimeRegistry {
  return updatePackage(registry, 'plugin', id, version);
}
