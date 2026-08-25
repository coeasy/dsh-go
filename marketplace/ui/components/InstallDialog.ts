export interface InstallDialogState {
  itemId: string;
  status: 'idle' | 'verify' | 'installing' | 'loaded' | 'failed';
  restartRequired: boolean;
}

export function createInstallDialogState(itemId: string): InstallDialogState {
  return {
    itemId,
    status: 'idle',
    restartRequired: false,
  };
}
