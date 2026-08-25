import { removeFromRegistry, upsertRegistry, type RuntimeRegistry } from '../storage/persistence';

export function listPlugins(registry: RuntimeRegistry) {
  return [...registry.items];
}

export function removePlugin(registry: RuntimeRegistry, id: string): RuntimeRegistry {
  return removeFromRegistry(registry, id);
}

export function updatePlugin(registry: RuntimeRegistry, id: string, version: string): RuntimeRegistry {
  return upsertRegistry(registry, {
    id,
    type: 'plugin',
    version,
    state: 'installed',
    restartRequired: true,
  });
}
