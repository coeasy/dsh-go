import { buildRuntimeInstallPlan, type LocalInstallPlan } from './install-adapter';
import type { ReleaseChannel } from './types';

export type InstallStage = 'search' | 'verify' | 'deploy' | 'runtime-plan' | 'loaded';

export interface MarketplaceInstallRequest {
  itemId: string;
  version?: string;
  channel?: ReleaseChannel;
}

export interface MarketplaceInstallResult {
  itemId: string;
  stage: InstallStage;
  restartRequired: boolean;
  executed: false;
  plan: LocalInstallPlan;
}

export function createInstallPlan(request: MarketplaceInstallRequest): MarketplaceInstallResult {
  const plan = buildRuntimeInstallPlan({
    id: request.itemId,
    version: request.version ?? '0.1.0',
    channel: request.channel,
  });
  return {
    itemId: request.itemId,
    stage: 'runtime-plan',
    restartRequired: true,
    executed: false,
    plan,
  };
}
