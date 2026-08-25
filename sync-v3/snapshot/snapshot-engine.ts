export interface RegistrySnapshot {
  hash: string;
  createdAt: string;
  plugins: unknown[];
}

export class SnapshotEngine {
  create(plugins: unknown[]): RegistrySnapshot {
    return {
      hash: String(JSON.stringify(plugins).length),
      createdAt: new Date().toISOString(),
      plugins
    };
  }
}
