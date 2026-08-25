export type RuntimeStage = 'verify' | 'deploy' | 'install' | 'loaded';

export interface RuntimePipelineResult {
  stage: RuntimeStage;
  restartRequired: boolean;
}

export function executeMarketplaceRuntimePipeline(): RuntimePipelineResult {
  return {
    stage: 'loaded',
    restartRequired: true,
  };
}
