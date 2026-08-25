import { getInstallDirectory } from '../installer/install-directory.js';
import { createRuntimeInstallPlan } from '../installer/installer.js';

export interface PluginInstallOptions {
  id: string;
  version?: string;
  source?: string;
}

export async function pluginInstall(options: PluginInstallOptions) {
  const directories = getInstallDirectory(process.env.HOME ?? '.');
  return createRuntimeInstallPlan({
    id: options.id,
    type: 'plugin',
    version: options.version ?? '0.1.0',
    source: options.source ?? '',
    targetDirectory: directories.packages.plugin,
  });
}
