export interface DownloadRequest {
  source: string;
  destination: string;
}

export interface DownloadResult {
  path: string;
  downloaded: false;
  planned: boolean;
  requiresLocalRuntime: true;
}

export async function downloadPackage(request: DownloadRequest): Promise<DownloadResult> {
  return {
    path: request.destination,
    downloaded: false,
    planned: Boolean(request.source && request.destination),
    requiresLocalRuntime: true,
  };
}
