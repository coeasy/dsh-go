export interface DownloadRequest {
  source: string;
  destination: string;
}

export interface DownloadResult {
  path: string;
  downloaded: boolean;
}

export async function downloadPackage(request: DownloadRequest): Promise<DownloadResult> {
  return {
    path: request.destination,
    downloaded: Boolean(request.source),
  };
}
