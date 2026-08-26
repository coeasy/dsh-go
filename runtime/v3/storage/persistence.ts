export type RuntimePackageType = 'plugin' | 'mcp' | 'skill' | 'agent';

export interface RuntimeRecord {
  id: string;
  type: RuntimePackageType;
  version: string;
  state: 'available' | 'installing' | 'installed' | 'verifying' | 'active' | 'disabled' | 'failed' | 'rollback' | 'removed';
  restartRequired?: boolean;
}

export interface RuntimeRegistry {
  version: '3';
  items: RuntimeRecord[];
}

function key(item: Pick<RuntimeRecord, 'id' | 'type'>): string {
  return `${item.type}:${item.id.toLowerCase()}`;
}

export function createRegistry(items: RuntimeRecord[] = []): RuntimeRegistry {
  return { version: '3', items: [...items] };
}

export function upsertRegistry(registry: RuntimeRegistry, item: RuntimeRecord): RuntimeRegistry {
  const itemKey = key(item);
  const items = registry.items.filter((entry) => key(entry) !== itemKey);
  return { ...registry, items: [...items, item] };
}

export function removeFromRegistry(registry: RuntimeRegistry, id: string, type: RuntimePackageType = 'plugin'): RuntimeRegistry {
  const itemKey = `${type}:${id.toLowerCase()}`;
  return { ...registry, items: registry.items.filter((entry) => key(entry) !== itemKey) };
}
