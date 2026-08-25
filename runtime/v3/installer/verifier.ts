export interface VerifyRequest {
  checksum?: string;
  expectedChecksum?: string;
}

export interface VerifyResult {
  verified: boolean;
  reason?: string;
}

export function verifyPackage(request: VerifyRequest): VerifyResult {
  if (!request.expectedChecksum) return { verified: false, reason: 'expected checksum is required' };
  if (!request.checksum) return { verified: false, reason: 'checksum is required' };
  const verified = request.checksum === request.expectedChecksum;
  return { verified, reason: verified ? undefined : 'checksum mismatch' };
}
