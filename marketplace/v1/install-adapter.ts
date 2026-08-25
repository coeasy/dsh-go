import type { ReleaseChannel } from './types';

export interface InstallRequest {
  id: string;
  version: string;
  channel?: ReleaseChannel;
  registryPath?: string;
  root?: string;
}

export interface LocalInstallPlan {
  command: 'node';
  argv: string[];
  requiresLocalRuntime: true;
  restartRequired: true;
}

export interface InstallResult {
  success: boolean;
  planned: boolean;
  executed: boolean;
  restartRequired: boolean;
  requiresLocalRuntime: boolean;
  plan: LocalInstallPlan;
  reason?: string;
}

export interface RuntimeInstaller {
  install(request: InstallRequest): Promise<InstallResult>;
}

export interface RuntimeInstallExecutor {
  execute(plan: LocalInstallPlan): Promise<{ success: boolean; reason?: string }>;
}

export function buildRuntimeInstallPlan(request: InstallRequest): LocalInstallPlan {
  const argv = ['runtime/cli.mjs', 'plugin', 'install', `${request.id}@${request.version}`];
  if (request.channel) argv.push('--channel', request.channel);
  if (request.registryPath) argv.push('--registry', request.registryPath);
  if (request.root) argv.push('--root', request.root);
  return { command: 'node', argv, requiresLocalRuntime: true, restartRequired: true };
}

export class MarketplaceInstallAdapter implements RuntimeInstaller {
  constructor(private readonly executor?: RuntimeInstallExecutor) {}

  async install(request: InstallRequest): Promise<InstallResult> {
    const plan = buildRuntimeInstallPlan(request);
    if (!this.executor) {
      return {
        success: false,
        planned: true,
        executed: false,
        restartRequired: true,
        requiresLocalRuntime: true,
        plan,
        reason: 'installation requires the local DSH runtime',
      };
    }

    const execution = await this.executor.execute(plan);
    return {
      success: execution.success,
      planned: true,
      executed: true,
      restartRequired: execution.success,
      requiresLocalRuntime: true,
      plan,
      reason: execution.reason,
    };
  }
}
