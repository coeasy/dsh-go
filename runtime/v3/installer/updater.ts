export interface UpdateRequest {
  id: string;
  fromVersion?: string;
  toVersion: string;
}

export interface UpdateResult {
  id: string;
  updated: boolean;
  rollbackAvailable: boolean;
}

export function updatePackage(request: UpdateRequest): UpdateResult {
  return {
    id: request.id,
    updated: true,
    rollbackAvailable: true,
  };
}
