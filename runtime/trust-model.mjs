import { packageSecurityDecision } from './advisory.mjs';

export const TRUST_TIERS = Object.freeze(['unverified', 'community', 'verified', 'trusted']);

function evidenceScore(security = {}) {
  let score = 0;
  if (security.provenance) score += 20;
  if (security.signature) score += 25;
  if (security.sbom) score += 15;
  if (security.license) score += 10;
  return score;
}

export function packageTrust(pkg) {
  const security = packageSecurityDecision(pkg, { blockCritical: false });
  const ownership = pkg?.publisher?.repository_ownership || 'unverified';
  const verifiedPublisher = ownership === 'verified' || pkg?.publisher?.verified === true;
  const verifiedMetadata = pkg?.metadata?.verified === true;
  const evidence = evidenceScore(pkg?.security || {});
  let score = evidence;
  if (verifiedPublisher) score += 25;
  else if (ownership === 'declared' || ownership === 'required') score += 10;
  if (verifiedMetadata) score += 10;
  if (security.yanked) score -= 25;
  if (security.revoked) score -= 100;
  if (security.critical) score -= 50;
  if (security.below_minimum_safe_version) score -= 50;
  score = Math.max(0, Math.min(100, score));
  const tier = security.revoked || security.critical || security.below_minimum_safe_version
    ? 'unverified'
    : score >= 80 ? 'trusted' : score >= 55 ? 'verified' : score >= 25 ? 'community' : 'unverified';
  return {
    tier,
    score,
    publisher_verified: verifiedPublisher,
    repository_ownership: ownership,
    evidence: {
      provenance: Boolean(pkg?.security?.provenance),
      signature: Boolean(pkg?.security?.signature),
      sbom: Boolean(pkg?.security?.sbom),
      license: Boolean(pkg?.security?.license),
    },
    security,
  };
}

export function popularityScore(pkg) {
  return Number(pkg?.metadata?.stars || pkg?.stars || 0);
}

export function marketplaceSignals(pkg) {
  return { trust: packageTrust(pkg), popularity: popularityScore(pkg) };
}
