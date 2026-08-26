import type { RuntimePackageType } from '../storage/persistence';

export type RuntimeStage = 'verify' | 'deploy' | 'runtime-plan' | 'installed' | 'loaded';

export interface RuntimePipelineResult {
  packageType: RuntimePackageType;
  stage: RuntimeStage;
  restartRequired: boolean;
  executed: boolean;
  requiresLocalRuntime: boolean;
  activation: 'planned' | 'restart-required' | 'active';
}

export function executeMarketplaceRuntimePipeline(
  localRuntime = false,
  packageType: RuntimePackageType = 'plugin',
  activated = false,
): RuntimePipelineResult {
  return {
    packageType,
    stage: activated ? 'loaded' : localRuntime ? 'installed' : 'runtime-plan',
    restartRequired: localRuntime && !activated,
    executed: localRuntime,
    requiresLocalRuntime: true,
    activation: activated ? 'active' : localRuntime ? 'restart-required' : 'planned',
  };
}
