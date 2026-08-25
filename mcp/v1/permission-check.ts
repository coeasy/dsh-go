import type { MCPPermission } from './types';

export interface MCPPermissionCheckResult {
  allowed: boolean;
  permissions: string[];
  denied: string[];
  reason?: string;
}

const KNOWN_PERMISSIONS = new Set<MCPPermission>(['network', 'filesystem']);

export function checkMCPPermissions(
  requested: string[],
  granted: string[] = [],
): MCPPermissionCheckResult {
  const grantedSet = new Set(granted);
  const denied = requested.filter((permission) => !KNOWN_PERMISSIONS.has(permission as MCPPermission) || !grantedSet.has(permission));
  return {
    allowed: denied.length === 0,
    permissions: [...requested],
    denied,
    reason: denied.length ? `permissions not granted: ${denied.join(', ')}` : undefined,
  };
}
