export interface RemoveResult {
  id: string;
  removed: boolean;
}

export function removePlugin(id: string): RemoveResult {
  return {
    id,
    removed: true,
  };
}
