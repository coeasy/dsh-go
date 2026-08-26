import type { RuntimePackageType } from '../storage/persistence';

export interface RemoveResult {
  id: string;
  type: RuntimePackageType;
  removed: false;
  planned: boolean;
  requiresLocalRuntime: true;
  command: 'node';
  argv: string[];
}

export function removePackage(id: string, type: RuntimePackageType = 'plugin'): RemoveResult {
  return {
    id,
    type,
    removed: false,
    planned: Boolean(id.trim()),
    requiresLocalRuntime: true,
    command: 'node',
    argv: ['runtime/cli.mjs', type, 'remove', id],
  };
}

export function removePlugin(id: string): RemoveResult {
  return removePackage(id, 'plugin');
}
