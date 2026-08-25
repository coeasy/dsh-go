export type DeployContext = {
  pluginId: string;
  version: string;
  runtimeVersion: string;
  permissions: Record<string, boolean>;
};

export type GateResult = {
  allowed: boolean;
  checks: Array<{ name: string; passed: boolean; reason?: string }>;
};

export function runDeployGate(ctx: DeployContext): GateResult {
  const checks = [
    {
      name: 'manifest',
      passed: Boolean(ctx.pluginId && ctx.version),
      reason: 'plugin id and version are required'
    },
    {
      name: 'runtime',
      passed: Boolean(ctx.runtimeVersion),
      reason: 'runtime version missing'
    },
    {
      name: 'permissions',
      passed: Object.values(ctx.permissions).every(Boolean) || Object.keys(ctx.permissions).length === 0,
      reason: 'permission validation failed'
    }
  ];

  return {
    allowed: checks.every((item) => item.passed),
    checks
  };
}
