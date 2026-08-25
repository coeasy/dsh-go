import { buildRuntimeInstallPlan, type LocalInstallPlan } from '../../marketplace/v1/install-adapter';
import { checkMCPPermissions } from './permission-check';

export type MCPInstallState = 'verify' | 'planned' | 'install' | 'bound' | 'running' | 'failed';

export interface MCPInstallOptions {
  version?: string;
  requestedPermissions?: string[];
  grantedPermissions?: string[];
}

export interface MCPInstallResult {
  serverId: string;
  state: MCPInstallState;
  plan?: LocalInstallPlan;
  reason?: string;
}

export function installMCP(serverId: string, options: MCPInstallOptions = {}): MCPInstallResult {
  if (!serverId.trim()) return { serverId, state: 'failed', reason: 'server id is required' };
  const permission = checkMCPPermissions(options.requestedPermissions ?? [], options.grantedPermissions ?? []);
  if (!permission.allowed) return { serverId, state: 'failed', reason: permission.reason };
  return {
    serverId,
    state: 'planned',
    plan: buildRuntimeInstallPlan({ id: serverId, version: options.version ?? '0.1.0' }),
  };
}
