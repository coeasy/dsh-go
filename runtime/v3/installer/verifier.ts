export interface VerifyRequest {
  checksum?: string;
  expectedChecksum?: string;
}

export interface VerifyResult {
  verified: boolean;
  reason?: string;
}

export function verifyPackage(request: VerifyRequest): VerifyResult {
  if (!request.expectedChecksum) {
    return { verified: true };
  }

  return {
    verified: request.checksum === request.expectedChecksum,
    reason: request.checksum === request.expectedChecksum ? undefined : 'checksum mismatch',
  };
}
