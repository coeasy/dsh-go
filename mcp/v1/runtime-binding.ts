import { checkMCPPermissions } from './permission-check';

export interface MCPRuntimeBinding {
  serverId: string;
  capabilities: string[];
  permissions: string[];
  runtime?: string;
  localOnly?: boolean;
  bound?: boolean;
  reason?: string;
}

export interface MCPRuntimeBindOptions {
  localRuntime?: boolean;
  grantedPermissions?: string[];
}

export class MCPRuntimeBinder {
  bind(binding: MCPRuntimeBinding, options: MCPRuntimeBindOptions = {}): MCPRuntimeBinding {
    const permission = checkMCPPermissions(binding.permissions, options.grantedPermissions ?? []);
    const bound = options.localRuntime === true && permission.allowed;
    return {
      ...binding,
      runtime: 'dsh-runtime-v3',
      localOnly: true,
      bound,
      reason: bound ? undefined : permission.reason ?? 'binding requires the local DSH runtime',
    };
  }
}
