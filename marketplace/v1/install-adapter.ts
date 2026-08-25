export interface InstallRequest {
  id: string;
  version: string;
}

export interface InstallResult {
  success: boolean;
  restartRequired: boolean;
}

export interface RuntimeInstaller {
  install(request: InstallRequest): Promise<InstallResult>;
}

export class MarketplaceInstallAdapter implements RuntimeInstaller {
  async install(): Promise<InstallResult> {
    return {
      success: true,
      restartRequired: true,
    };
  }
}
