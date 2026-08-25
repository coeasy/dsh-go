export type InstallState =
  | 'downloaded'
  | 'verified'
  | 'installed'
  | 'loaded'
  | 'running'
  | 'failed';

export interface InstallRecord {
  pluginId: string;
  state: InstallState;
  restartRequired: boolean;
}

export class PluginInstallLifecycle {
  transition(record: InstallRecord, next: InstallState): InstallRecord {
    return {
      ...record,
      state: next,
      restartRequired: next === 'loaded',
    };
  }
}
