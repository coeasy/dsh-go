export function listPlugins(registry: { packages: unknown[] }) {
  return registry.packages;
}

export function removePlugin(id: string) {
  return { id, removed: true };
}

export function updatePlugin(id: string, version: string) {
  return { id, version, updated: true };
}
