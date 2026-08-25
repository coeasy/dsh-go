export interface RuntimeRecord {
  id: string;
  type: 'plugin' | 'mcp' | 'skill' | 'agent';
  version: string;
  state: 'installed' | 'enabled' | 'disabled' | 'failed';
}

export interface RuntimeRegistry {
  version: string;
  items: RuntimeRecord[];
}

export function createRegistry(items: RuntimeRecord[] = []): RuntimeRegistry {
  return { version: '1', items };
}

export function upsertRegistry(registry: RuntimeRegistry, item: RuntimeRecord): RuntimeRegistry {
  const items = registry.items.filter((entry) => entry.id !== item.id);
  return { ...registry, items: [...items, item] };
}

export function removeFromRegistry(registry: RuntimeRegistry, id: string): RuntimeRegistry {
  return { ...registry, items: registry.items.filter((entry) => entry.id !== id) };
}
