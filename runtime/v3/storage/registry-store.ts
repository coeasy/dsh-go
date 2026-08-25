export type RuntimePackageType = 'plugin' | 'mcp' | 'skill' | 'agent';

export type RuntimePackageState =
  | 'installed'
  | 'enabled'
  | 'disabled'
  | 'failed';

export interface RuntimePackageRecord {
  id: string;
  type: RuntimePackageType;
  version: string;
  state: RuntimePackageState;
  installedAt: string;
}

export interface RuntimeRegistry {
  packages: RuntimePackageRecord[];
}

export class RuntimeRegistryStore {
  private registry: RuntimeRegistry;

  constructor(initial?: RuntimeRegistry) {
    this.registry = initial ?? { packages: [] };
  }

  list(): RuntimePackageRecord[] {
    return [...this.registry.packages];
  }

  get(id: string): RuntimePackageRecord | undefined {
    return this.registry.packages.find((item) => item.id === id);
  }

  upsert(record: RuntimePackageRecord): RuntimePackageRecord {
    const index = this.registry.packages.findIndex((item) => item.id === record.id);

    if (index >= 0) {
      this.registry.packages[index] = record;
    } else {
      this.registry.packages.push(record);
    }

    return record;
  }

  remove(id: string): boolean {
    const before = this.registry.packages.length;
    this.registry.packages = this.registry.packages.filter((item) => item.id !== id);
    return this.registry.packages.length !== before;
  }
}
