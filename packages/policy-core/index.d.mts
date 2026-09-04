export type PolicyDecisionName = 'allow' | 'deny' | 'require-confirmation';
export type TrustLevel = 'unverified' | 'community' | 'verified' | 'trusted';

export interface PolicyDecision {
  decision: PolicyDecisionName;
  operation: string;
  package_key: string | null;
  trust: {
    level: TrustLevel;
    publisher_verified: boolean;
    cryptographic_signature_verified: boolean;
    slsa_provenance_verified: boolean;
    signer_identity: string | null;
    signer_revoked: boolean;
    repository_ownership: string | null;
  };
  registry: {
    name: string;
    url: string | null;
    trusted: boolean;
    organization: string | null;
  };
  required_permissions: string[];
  reasons: string[];
  warnings: string[];
  evaluated_at: string;
}

export declare const POLICY_DECISIONS: Readonly<{
  ALLOW: 'allow';
  DENY: 'deny';
  REQUIRE_CONFIRMATION: 'require-confirmation';
}>;
export declare const TRUST_LEVELS: readonly TrustLevel[];
export declare function classifyTrust(pkg?: Record<string, unknown>, input?: Record<string, unknown>): PolicyDecision['trust'];
export declare function evaluatePackagePolicy(input?: Record<string, unknown>): PolicyDecision;
export declare function assertPolicyAllowed(input?: Record<string, unknown>): PolicyDecision;
export declare function compactPolicySnapshot(decision?: PolicyDecision | null): Record<string, unknown> | null;
