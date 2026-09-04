import { classifyTrust } from '../packages/policy-core/index.mjs';
import { packageSecurityDecision } from './advisory.mjs';

export const TRUST_TIERS = Object.freeze(['unverified', 'community', 'verified', 'trusted']);

export function packageTrust(pkg) {
  const security = packageSecurityDecision(pkg, { blockCritical: false });
  const snapshot = pkg?.trust_snapshot || {};
  const verification = pkg?.supply_chain_verification || pkg?.verification || {};
  const trust = classifyTrust(pkg, {
    publisher: pkg?.publisher,
    security: pkg?.security,
    verification: {
      ...verification,
      cryptographic_signature_verified: snapshot.cryptographic_signature_verified ?? verification.cryptographic_signature_verified,
      slsa_provenance_verified: snapshot.slsa_provenance_verified ?? verification.slsa_provenance_verified,
      signer_identity: snapshot.signer_identity || verification.signer_identity,
    },
    publisher_verified: snapshot.publisher_verified,
    signer_identity: snapshot.signer_identity,
    signer_revoked: snapshot.signer_revoked,
  });
  const blocked = security.revoked || security.critical || security.below_minimum_safe_version || snapshot.signer_revoked === true;
  const tier = blocked ? 'unverified' : trust.level;
  return {
    tier,
    trusted: tier === 'trusted',
    publisher_verified: trust.publisher_verified,
    repository_ownership: trust.repository_ownership,
    cryptographic_signature_verified: trust.cryptographic_signature_verified,
    slsa_provenance_verified: trust.slsa_provenance_verified,
    signer_identity: trust.signer_identity,
    signer_revoked: trust.signer_revoked,
    trust_root_revision: snapshot.trust_root_revision || null,
    evidence: {
      provenance_declared: Boolean(pkg?.security?.provenance),
      signature_declared: Boolean(pkg?.security?.signature),
      sbom_declared: Boolean(pkg?.security?.sbom),
      license_declared: Boolean(pkg?.security?.license),
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
