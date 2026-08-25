export type MCPInstallState = 'verify' | 'install' | 'bound' | 'running' | 'failed';

export interface MCPInstallResult {
  serverId: string;
  state: MCPInstallState;
}

export function installMCP(serverId: string): MCPInstallResult {
  return { serverId, state: 'bound' };
}
