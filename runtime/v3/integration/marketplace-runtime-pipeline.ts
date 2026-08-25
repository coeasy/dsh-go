export type RuntimeStage = 'verify' | 'deploy' | 'runtime-plan' | 'installed' | 'loaded';

export interface RuntimePipelineResult {
  stage: RuntimeStage;
  restartRequired: boolean;
  executed: boolean;
  requiresLocalRuntime: boolean;
}

export function executeMarketplaceRuntimePipeline(localRuntime = false): RuntimePipelineResult {
  return {
    stage: localRuntime ? 'installed' : 'runtime-plan',
    restartRequired: localRuntime,
    executed: localRuntime,
    requiresLocalRuntime: true,
  };
}
