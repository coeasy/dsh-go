import type { RuntimePackageType } from '../storage/registry-store';

export interface InstallRequest {
  id: string;
  type: RuntimePackageType;
  version: string;
  source: string;
  targetDirectory?: string;
}

export interface InstallResult {
  id: string;
  type: RuntimePackageType;
  installed: false;
  planned: boolean;
  restartRequired: true;
  requiresLocalRuntime: true;
  command: 'node';
  argv: string[];
  reason?: string;
}

export function createRuntimeInstallPlan(request: InstallRequest): InstallResult {
  const valid = Boolean(request.id.trim() && request.version.trim());
  const argv = ['runtime/cli.mjs', request.type, 'install', `${request.id}@${request.version}`];
  if (request.targetDirectory) argv.push('--root', request.targetDirectory);
  return {
    id: request.id,
    type: request.type,
    installed: false,
    planned: valid,
    restartRequired: true,
    requiresLocalRuntime: true,
    command: 'node',
    argv,
    reason: valid ? 'execute this plan through the local Runtime Platform V3' : 'id and version are required',
  };
}

export async function installPackage(request: InstallRequest): Promise<InstallResult> {
  return createRuntimeInstallPlan(request);
}

export async function installPlugin(request: InstallRequest): Promise<InstallResult> {
  return createRuntimeInstallPlan({ ...request, type: 'plugin' });
}

export class PackageInstaller {
  async install(request: InstallRequest): Promise<InstallResult> {
    return installPackage(request);
  }
}

export class PluginInstaller extends PackageInstaller {}
