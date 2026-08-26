import { getInstallDirectory, type PackageType } from '../installer/install-directory.js';
import { createRuntimeInstallPlan } from '../installer/installer.js';

export interface PackageInstallOptions {
  id: string;
  type: PackageType;
  version?: string;
  source?: string;
}

export async function packageInstall(options: PackageInstallOptions) {
  const directories = getInstallDirectory(process.env.HOME ?? '.');
  return createRuntimeInstallPlan({
    id: options.id,
    type: options.type,
    version: options.version ?? '0.1.0',
    source: options.source ?? '',
    targetDirectory: directories.packages[options.type],
  });
}

export interface PluginInstallOptions extends Omit<PackageInstallOptions, 'type'> {}

export async function pluginInstall(options: PluginInstallOptions) {
  return packageInstall({ ...options, type: 'plugin' });
}
