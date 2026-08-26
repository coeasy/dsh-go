import type { EcosystemPackageV2 } from './types';

export interface ProvenanceValidation {
  valid: boolean;
  checks: string[];
  reasons: string[];
}

const SHA256 = /^[a-f0-9]{64}$/i;

export function validateSupplyChainEvidence(item: EcosystemPackageV2): ProvenanceValidation {
  const checks: string[] = [];
  const reasons: string[] = [];
  const provenance = item.security?.provenance;
  const signature = item.security?.signature;
  const sbom = item.security?.sbom;

  if (provenance) {
    if (provenance.uri?.startsWith('https://')) checks.push('provenance:https');
    else if (provenance.uri) reasons.push('provenance URI must use HTTPS');
    if (provenance.digest) {
      if (SHA256.test(provenance.digest.replace(/^sha256:/, ''))) checks.push('provenance:digest');
      else reasons.push('provenance digest must be SHA-256');
    }
  }
  if (signature) {
    if (signature.identity) checks.push('signature:identity');
    else reasons.push('signature identity is required');
    if (signature.bundle) checks.push('signature:bundle');
    else reasons.push('signature bundle reference is required');
  }
  if (sbom) {
    if (sbom.uri?.startsWith('https://')) checks.push('sbom:https');
    else if (sbom.uri) reasons.push('SBOM URI must use HTTPS');
    if (sbom.digest && !SHA256.test(sbom.digest.replace(/^sha256:/, ''))) reasons.push('SBOM digest must be SHA-256');
  }
  if (item.security?.yanked) reasons.push('release is yanked');
  return { valid: reasons.length === 0, checks, reasons };
}

export function requirePublishEvidence(item: EcosystemPackageV2): ProvenanceValidation {
  const result = validateSupplyChainEvidence(item);
  const missing: string[] = [];
  if (!item.security?.provenance) missing.push('provenance');
  if (!item.security?.signature) missing.push('signature');
  if (!item.security?.sbom) missing.push('sbom');
  if (!item.security?.license) missing.push('license');
  if (missing.length) result.reasons.push(`missing release evidence: ${missing.join(', ')}`);
  result.valid = result.reasons.length === 0;
  return result;
}
