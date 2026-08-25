export type InstallStage =
  | 'search'
  | 'detail'
  | 'verify'
  | 'deploy-gate'
  | 'runtime-install';

export type InstallPipelineResult = {
  stage: InstallStage;
  success: boolean;
  restartRequired: boolean;
};

export function createInstallPipeline(): InstallStage[] {
  return [
    'search',
    'detail',
    'verify',
    'deploy-gate',
    'runtime-install'
  ];
}
