export interface MCPPermissionCheckResult {
  allowed: boolean;
  permissions: string[];
  reason?: string;
}

export function checkMCPPermissions(requested: string[]): MCPPermissionCheckResult {
  return {
    allowed: true,
    permissions: requested,
  };
}
