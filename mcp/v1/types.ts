export type MCPPermission = 'network' | 'filesystem';

export interface MCPServerManifest {
  id: string;
  name: string;
  version: string;
  capabilities: string[];
  permissions: {
    network?: boolean;
    filesystem?: boolean;
  };
}

export interface MCPServerFilter {
  capability?: string;
}

export function requestedMCPPermissions(manifest: MCPServerManifest): MCPPermission[] {
  const permissions: MCPPermission[] = [];
  if (manifest.permissions.network) permissions.push('network');
  if (manifest.permissions.filesystem) permissions.push('filesystem');
  return permissions;
}
