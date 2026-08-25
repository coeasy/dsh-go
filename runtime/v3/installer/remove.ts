export interface RemoveResult {
  id: string;
  removed: false;
  planned: boolean;
  requiresLocalRuntime: true;
  command: 'node';
  argv: string[];
}

export function removePlugin(id: string): RemoveResult {
  return {
    id,
    removed: false,
    planned: Boolean(id.trim()),
    requiresLocalRuntime: true,
    command: 'node',
    argv: ['runtime/cli.mjs', 'plugin', 'remove', id],
  };
}
