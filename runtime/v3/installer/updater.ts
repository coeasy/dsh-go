export interface UpdateRequest {
  id: string;
  fromVersion?: string;
  toVersion: string;
}

export interface UpdateResult {
  id: string;
  updated: false;
  planned: boolean;
  rollbackAvailable: false;
  requiresLocalRuntime: true;
  command: 'node';
  argv: string[];
}

export function updatePackage(request: UpdateRequest): UpdateResult {
  return {
    id: request.id,
    updated: false,
    planned: Boolean(request.id.trim() && request.toVersion.trim()),
    rollbackAvailable: false,
    requiresLocalRuntime: true,
    command: 'node',
    argv: ['runtime/cli.mjs', 'plugin', 'update', request.id, request.toVersion],
  };
}
