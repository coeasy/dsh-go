import { discoverMCP, type MCPDiscoveryResult } from './discovery';
import type { MCPServerFilter, MCPServerManifest } from './types';

export function discoverMCPServers(
  manifests: MCPServerManifest[] = [],
  filter: MCPServerFilter = {},
): MCPDiscoveryResult[] {
  return discoverMCP(manifests, filter);
}
