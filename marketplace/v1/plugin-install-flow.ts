export type InstallStage = 'search' | 'verify' | 'deploy' | 'install' | 'loaded';

export interface MarketplaceInstallRequest {
  itemId: string;
  version?: string;
}

export interface MarketplaceInstallResult {
  itemId: string;
  stage: InstallStage;
  restartRequired: boolean;
}

export function createInstallPlan(request: MarketplaceInstallRequest): MarketplaceInstallResult {
  return {
    itemId: request.itemId,
    stage: 'deploy',
    restartRequired: true,
  };
}
