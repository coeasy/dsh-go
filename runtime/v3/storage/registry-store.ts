export type RuntimePackageType = 'plugin' | 'mcp' | 'skill' | 'agent';

export type RuntimePackageState =
  | 'available'
  | 'installing'
  | 'installed'
  | 'verifying'
  | 'active'
  | 'disabled'
  | 'failed'
  | 'rollback'
  | 'removed';

export interface RuntimePackageRecord {
  id: string;
  type: RuntimePackageType;
  version: string;
  state: RuntimePackageState;
  channel?: string;
  path?: string;
  commit?: string;
  enabled?: boolean;
  activated?: boolean;
  restartRequired?: boolean;
  installedAt?: string;
}

export interface RuntimeRegistry {
  schemaVersion?: 3;
  generation?: number;
  packages: RuntimePackageRecord[];
}

export type LegacyRuntimePackageRecord = Omit<RuntimePackageRecord, 'type'> & { type?: RuntimePackageType };

export interface LegacyRuntimeRegistry {
  schema_version?: 1 | 2 | 3;
  generation?: number;
  plugins?: LegacyRuntimePackageRecord[];
  packages?: LegacyRuntimePackageRecord[];
}

export function runtimePackageKey(type: RuntimePackageType, id: string): string {
  return `${type}:${id.toLowerCase()}`;
}

export function migrateRuntimeRegistry(input: RuntimeRegistry | LegacyRuntimeRegistry): RuntimeRegistry {
  const source = 'packages' in input && Array.isArray(input.packages)
    ? input.packages
    : 'plugins' in input && Array.isArray(input.plugins)
      ? input.plugins.map((record) => ({ ...record, type: 'plugin' as const }))
      : [];
  const packages = source.map((record) => ({ ...record, type: record.type ?? 'plugin' } as RuntimePackageRecord));
  const seen = new Set<string>();
  for (const record of packages) {
    const key = runtimePackageKey(record.type, record.id);
    if (seen.has(key)) throw new Error(`duplicate runtime package: ${key}`);
    seen.add(key);
  }
  return { schemaVersion: 3, generation: input.generation ?? 0, packages };
}

export class RuntimeRegistryStore {
  private registry: RuntimeRegistry;

  constructor(initial?: RuntimeRegistry | LegacyRuntimeRegistry) {
    this.registry = migrateRuntimeRegistry(initial ?? { packages: [] });
  }

  list(type?: RuntimePackageType): RuntimePackageRecord[] {
    return this.registry.packages.filter((item) => !type || item.type === type).map((item) => ({ ...item }));
  }

  get(id: string, type: RuntimePackageType = 'plugin'): RuntimePackageRecord | undefined {
    const key = runtimePackageKey(type, id);
    return this.registry.packages.find((item) => runtimePackageKey(item.type, item.id) === key);
  }

  upsert(record: RuntimePackageRecord): RuntimePackageRecord {
    const key = runtimePackageKey(record.type, record.id);
    const index = this.registry.packages.findIndex((item) => runtimePackageKey(item.type, item.id) === key);
    if (index >= 0) this.registry.packages[index] = { ...record };
    else this.registry.packages.push({ ...record });
    return record;
  }

  remove(id: string, type: RuntimePackageType = 'plugin'): boolean {
    const key = runtimePackageKey(type, id);
    const before = this.registry.packages.length;
    this.registry.packages = this.registry.packages.filter((item) => runtimePackageKey(item.type, item.id) !== key);
    return this.registry.packages.length !== before;
  }

  snapshot(): RuntimeRegistry {
    return {
      schemaVersion: 3,
      generation: this.registry.generation ?? 0,
      packages: this.list(),
    };
  }
}
