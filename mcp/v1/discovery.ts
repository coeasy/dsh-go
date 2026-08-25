import type { MCPServerFilter, MCPServerManifest } from './types';

export interface MCPDiscoveryResult {
  id: string;
  name: string;
  version: string;
  capabilities: string[];
}

export function discoverMCP(
  manifests: MCPServerManifest[] = [],
  filter: MCPServerFilter = {},
): MCPDiscoveryResult[] {
  const capability = filter.capability?.toLocaleLowerCase();
  return manifests
    .filter((manifest) => !capability || manifest.capabilities.some((entry) => entry.toLocaleLowerCase() === capability))
    .map((manifest) => ({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      capabilities: [...manifest.capabilities],
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}
