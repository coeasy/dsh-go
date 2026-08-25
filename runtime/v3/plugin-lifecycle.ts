export type PluginState =
  | 'downloaded'
  | 'verified'
  | 'installed'
  | 'loaded'
  | 'running'
  | 'failed';

export type LifecycleResult = {
  state: PluginState;
  restartRequired: boolean;
  error?: string;
};

export function advanceLifecycle(state: PluginState): LifecycleResult {
  const transitions: Record<PluginState, LifecycleResult> = {
    downloaded: { state: 'verified', restartRequired: false },
    verified: { state: 'installed', restartRequired: false },
    installed: { state: 'loaded', restartRequired: true },
    loaded: { state: 'running', restartRequired: false },
    running: { state: 'running', restartRequired: false },
    failed: { state: 'failed', restartRequired: false, error: 'plugin lifecycle stopped' }
  };

  return transitions[state];
}
