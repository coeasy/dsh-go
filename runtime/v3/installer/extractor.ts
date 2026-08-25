export interface ExtractRequest {
  archive: string;
  target: string;
}

export interface ExtractResult {
  target: string;
  extracted: false;
  planned: boolean;
  requiresLocalRuntime: true;
}

export function extractPackage(request: ExtractRequest): ExtractResult {
  return {
    target: request.target,
    extracted: false,
    planned: Boolean(request.archive && request.target),
    requiresLocalRuntime: true,
  };
}
