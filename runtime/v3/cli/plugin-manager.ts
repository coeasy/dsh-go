import { createRegistry, removeFromRegistry, upsertRegistry } from '../storage/persistence.js';

export function listPlugins() {
  return createRegistry().items;
}

export function removePlugin(id: string) {
  return removeFromRegistry(createRegistry(), id);
}

export function updatePlugin(id: string, version: string) {
  return upsertRegistry(createRegistry(), {
    id,
    type: 'plugin',
    version,
    state: 'installed',
  });
}
