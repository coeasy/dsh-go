import type { RuntimePackageType } from '../storage/persistence';

export interface UpdateRequest {
  id: string;
  type?: RuntimePackageType;
  fromVersion?: string;
  toVersion: string;
}

export interface UpdateResult {
  id: string;
  type: RuntimePackageType;
  updated: false;
  planned: boolean;
  rollbackAvailable: false;
  requiresLocalRuntime: true;
  command: 'node';
  argv: string[];
}

export function updatePackage(request: UpdateRequest): UpdateResult {
  const type = request.type ?? 'plugin';
  return {
    id: request.id,
    type,
    updated: false,
    planned: Boolean(request.id.trim() && request.toVersion.trim()),
    rollbackAvailable: false,
    requiresLocalRuntime: true,
    command: 'node',
    argv: ['runtime/cli.mjs', type, 'update', request.id, request.toVersion],
  };
}
