export interface ExtractRequest {
  archive: string;
  target: string;
}

export interface ExtractResult {
  target: string;
  extracted: boolean;
}

export function extractPackage(request: ExtractRequest): ExtractResult {
  return {
    target: request.target,
    extracted: Boolean(request.archive),
  };
}
