export interface DeployContext {
  pluginId: string;
  version: string;
  runtimeVersion: string;
  permissions?: string[];
}

export interface DeployResult {
  allowed: boolean;
  reasons: string[];
}

export class DeployGateChecker {
  constructor(private readonly currentRuntime: string = '0.1.0') {}

  check(context: DeployContext): DeployResult {
    const reasons: string[] = [];

    if (!context.pluginId) {
      reasons.push('missing plugin id');
    }

    if (context.runtimeVersion !== this.currentRuntime) {
      reasons.push(`runtime mismatch: ${context.runtimeVersion}`);
    }

    return {
      allowed: reasons.length === 0,
      reasons,
    };
  }
}
