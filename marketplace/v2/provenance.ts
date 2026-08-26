import type { EcosystemPackageV2 } from './types';

export interface ProvenanceValidation {
  valid: boolean;
  checks: string[];
  reasons: string[];
}

const SHA256 = /^[a-f0-9]{64}$/i;
const SLSA_PROVENANCE_V1 = 'https://slsa.dev/provenance/v1';

export function validateSupplyChainEvidence(item: EcosystemPackageV2): ProvenanceValidation {
  const checks: string[] = [];
  const reasons: string[] = [];
  const provenance = item.security?.provenance;
  const signature = item.security?.signature;
  const sbom = item.security?.sbom;

  if (provenance) {
    if (provenance.uri?.startsWith('https://')) checks.push('provenance:https');
    else if (provenance.uri && !/^[a-z][a-z0-9+.-]*:/i.test(provenance.uri)) checks.push('provenance:local');
    else if (provenance.uri) reasons.push('provenance URI must use HTTPS or a package-local path');
    if (provenance.digest) {
      if (SHA256.test(provenance.digest.replace(/^sha256:/, ''))) checks.push('provenance:digest');
      else reasons.push('provenance digest must be SHA-256');
    }
    if (provenance.provider === 'slsa' || provenance.required) {
      if (provenance.predicate_type && provenance.predicate_type !== SLSA_PROVENANCE_V1) {
        reasons.push(`SLSA predicate_type must be ${SLSA_PROVENANCE_V1}`);
      } else {
        checks.push('provenance:slsa-v1');
      }
      if (!provenance.uri) reasons.push('required SLSA provenance must declare uri/path');
      if (!provenance.digest) reasons.push('required SLSA provenance must declare SHA-256 digest');
    }
  }
  if (signature) {
    if (signature.identity) checks.push('signature:identity');
    else reasons.push('signature identity is required');
    if (signature.bundle || signature.uri) checks.push('signature:bundle');
    else reasons.push('signature bundle reference is required');
    const provider = String(signature.provider || '').toLowerCase();
    if (['sigstore', 'cosign'].includes(provider) || signature.required) {
      if (signature.issuer || signature.oidc_issuer) checks.push('signature:issuer');
      else reasons.push('Sigstore signature requires an OIDC issuer');
      const signed = signature.signed || 'provenance';
      if (!['provenance', 'sbom'].includes(signed)) reasons.push('Sigstore signed payload must be provenance or sbom');
      else if (!item.security?.[signed]) reasons.push(`Sigstore signed payload ${signed} is not declared`);
      else checks.push(`signature:signed-${signed}`);
    }
  }
  if (sbom) {
    if (sbom.uri?.startsWith('https://')) checks.push('sbom:https');
    else if (sbom.uri && !/^[a-z][a-z0-9+.-]*:/i.test(sbom.uri)) checks.push('sbom:local');
    else if (sbom.uri) reasons.push('SBOM URI must use HTTPS or a package-local path');
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
