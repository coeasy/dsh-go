import {
  createRegistry,
  removeFromRegistry,
  upsertRegistry,
  type RuntimePackageType,
  type RuntimeRegistry,
} from '../storage/persistence.js';

export function listPackages(registry: RuntimeRegistry = createRegistry(), type?: RuntimePackageType) {
  return registry.items.filter((item) => !type || item.type === type);
}

export function removePackage(registry: RuntimeRegistry, type: RuntimePackageType, id: string) {
  return removeFromRegistry(registry, id, type);
}

export function updatePackage(registry: RuntimeRegistry, type: RuntimePackageType, id: string, version: string) {
  return upsertRegistry(registry, {
    id,
    type,
    version,
    state: 'installed',
    restartRequired: true,
  });
}

export function listPlugins(registry: RuntimeRegistry = createRegistry()) {
  return listPackages(registry, 'plugin');
}

export function removePlugin(registry: RuntimeRegistry, id: string) {
  return removePackage(registry, 'plugin', id);
}

export function updatePlugin(registry: RuntimeRegistry, id: string, version: string) {
  return updatePackage(registry, 'plugin', id, version);
}
