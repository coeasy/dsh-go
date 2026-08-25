import type { RuntimePackageType } from '../storage/registry-store';

export interface InstallRequest {
  id: string;
  type: RuntimePackageType;
  version: string;
  source: string;
}

export interface InstallResult {
  id: string;
  installed: boolean;
  restartRequired: boolean;
}

export class PluginInstaller {
  async install(request: InstallRequest): Promise<InstallResult> {
    return {
      id: request.id,
      installed: true,
      restartRequired: true,
    };
  }
}
