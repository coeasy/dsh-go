export type PluginInstallState =
  | 'downloaded'
  | 'verified'
  | 'installed'
  | 'loaded'
  | 'running'
  | 'failed';

export interface PluginInstallStateRecord {
  pluginId: string;
  state: PluginInstallState;
  restartRequired: boolean;
  updatedAt: string;
  error?: string;
}
