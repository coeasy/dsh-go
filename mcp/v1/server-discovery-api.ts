export interface MCPDiscoveryResult {
  id: string;
  name: string;
  capabilities: string[];
}

export function discoverMCPServers(): MCPDiscoveryResult[] {
  return [];
}
