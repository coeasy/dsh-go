import { buildRuntimeInstallPlan, type LocalInstallPlan } from '../../v1/install-adapter';
import type { ReleaseChannel } from '../../v1/types';

export type InstallDialogStatus =
  | 'idle'
  | 'verify'
  | 'planned'
  | 'executing'
  | 'restart-required'
  | 'active'
  | 'failed';

export interface InstallDialogState {
  itemId: string;
  status: InstallDialogStatus;
  restartRequired: boolean;
  executed: boolean;
  plan?: LocalInstallPlan;
  error?: string;
}

export function createInstallDialogState(itemId: string): InstallDialogState {
  return { itemId, status: 'idle', restartRequired: false, executed: false };
}

export function planInstallDialog(
  state: InstallDialogState,
  version = '0.1.0',
  channel?: ReleaseChannel,
): InstallDialogState {
  const plan = buildRuntimeInstallPlan({ id: state.itemId, version, channel });
  return { ...state, status: 'planned', restartRequired: true, executed: false, plan, error: undefined };
}

export function markInstallExecuted(state: InstallDialogState, success: boolean, error?: string): InstallDialogState {
  if (!success) return { ...state, status: 'failed', executed: true, restartRequired: false, error: error ?? 'local runtime installation failed' };
  return { ...state, status: 'restart-required', executed: true, restartRequired: true, error: undefined };
}

export function markInstallActivated(state: InstallDialogState): InstallDialogState {
  if (state.status !== 'restart-required') throw new Error('plugin can only become active after a successful local install and client restart');
  return { ...state, status: 'active', restartRequired: false };
}
