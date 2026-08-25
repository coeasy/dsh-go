export interface PluginVersion {
  version: string;
  source: string;
  checksum?: string;
}

export function getPluginVersions(id: string): PluginVersion[] {
  return id ? [] : [];
}
