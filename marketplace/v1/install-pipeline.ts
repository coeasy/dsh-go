import type { InstallResult } from './install-adapter';
import type { TrustResult } from './trust/validator';

export type InstallStage = 'search' | 'detail' | 'verify' | 'deploy-gate' | 'runtime-plan';

export type InstallPipelineResult = {
  stage: InstallStage;
  success: boolean;
  restartRequired: boolean;
  executableLocally: boolean;
  reasons: string[];
};

export function createInstallPipeline(): InstallStage[] {
  return ['search', 'detail', 'verify', 'deploy-gate', 'runtime-plan'];
}

export function summarizeInstallPipeline(trust: TrustResult, result: InstallResult): InstallPipelineResult {
  return {
    stage: 'runtime-plan',
    success: trust.allowed && result.success,
    restartRequired: result.restartRequired,
    executableLocally: result.requiresLocalRuntime,
    reasons: [...trust.reasons, ...(result.reason ? [result.reason] : [])],
  };
}
