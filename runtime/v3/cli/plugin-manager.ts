import {
  createRegistry,
  removeFromRegistry,
  upsertRegistry,
  type RuntimeRegistry,
} from '../storage/persistence.js';

export function listPlugins(registry: RuntimeRegistry = createRegistry()) {
  return [...registry.items];
}

export function removePlugin(registry: RuntimeRegistry, id: string) {
  return removeFromRegistry(registry, id);
}

export function updatePlugin(registry: RuntimeRegistry, id: string, version: string) {
  return upsertRegistry(registry, {
    id,
    type: 'plugin',
    version,
    state: 'installed',
    restartRequired: true,
  });
}
