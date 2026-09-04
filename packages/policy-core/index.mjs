import { normalizePackageId, normalizePackageType, packageKey, satisfiesRange } from '../protocol-core/index.mjs';

export const POLICY_DECISIONS = Object.freeze({
  ALLOW: 'allow',
  DENY: 'deny',
  REQUIRE_CONFIRMATION: 'require-confirmation',
});

export const TRUST_LEVELS = Object.freeze(['unverified', 'community', 'verified', 'trusted']);

const LOAD_OPERATIONS = new Set(['install', 'update', 'rollback', 'restore', 'activate', 'enable']);
const MUTATION_OPERATIONS = new Set([...LOAD_OPERATIONS, 'remove', 'disable', 'config-write', 'secret-write']);
const CRITICAL_SEVERITIES = new Set(['critical']);

function clean(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function releaseSecurity(pkg = {}, input = {}) {
  return {
    ...(pkg.security && typeof pkg.security === 'object' ? pkg.security : {}),
    ...(input.security && typeof input.security === 'object' ? input.security : {}),
  };
}

function advisoryList(pkg = {}, input = {}) {
  const values = [];
  for (const source of [input.advisories, pkg.advisories, pkg.security?.advisories]) {
    if (Array.isArray(source)) values.push(...source);
  }
  return values.filter((item) => item && typeof item === 'object');
}

function advisoryApplies(item, pkg) {
  const target = item.package || item.target || {};
  if (target.type && (!pkg.type || normalizePackageType(target.type) !== normalizePackageType(pkg.type))) return false;
  if (target.id && (!pkg.id || normalizePackageId(target.id) !== normalizePackageId(pkg.id))) return false;
  const affected = item.affected || item.range || '*';
  if (pkg.version && affected) {
    try { if (!satisfiesRange(pkg.version, affected)) return false; }
    catch { return false; }
  }
  return true;
}

function criticalAdvisories(pkg, input) {
  return advisoryList(pkg, input).filter((item) => {
    if (!advisoryApplies(item, pkg)) return false;
    const severity = String(item.severity || item.level || '').trim().toLowerCase();
    return item.revoked === true || CRITICAL_SEVERITIES.has(severity) || item.blocked === true;
  });
}

function permissionNames(value) {
  const permissions = Array.isArray(value) ? value : [];
  return [...new Set(permissions.map((item) => {
    if (typeof item === 'string') return item.trim();
    if (item && typeof item === 'object') return clean(item.name || item.id || item.permission);
    return null;
  }).filter(Boolean))].sort();
}

function registryIdentity(input = {}) {
  const registry = input.registry && typeof input.registry === 'object' ? input.registry : {};
  return {
    name: clean(registry.name) || 'official',
    url: clean(registry.url),
    trusted: registry.trusted !== false,
    organization: clean(registry.organization),
  };
}

function trustInputs(pkg = {}, input = {}) {
  const publisher = input.publisher || pkg.publisher || {};
  const security = releaseSecurity(pkg, input);
  const verification = input.verification || input.supply_chain_verification || pkg.supply_chain_verification || {};
  const identity = verification.identity || input.identity || {};
  const ownership = publisher.repository_ownership || publisher.ownership || null;
  const publisherVerified = publisher.verified === true || ownership === 'verified' || input.publisher_verified === true;
  const signatureVerified = verification.cryptographic_signature_verified === true
    || input.cryptographic_signature_verified === true
    || identity.cryptographic_signature_verified === true;
  const provenanceVerified = verification.slsa_provenance_verified === true
    || input.slsa_provenance_verified === true
    || identity.slsa_provenance_verified === true;
  const signerIdentity = clean(
    input.signer_identity
      || identity.sigstore?.identity
      || identity.identity
      || security.signature?.identity,
  );
  const signerRevoked = input.signer_revoked === true || input.trust_root?.signer_revoked === true;
  const signatureRequired = security.signature?.required === true || input.signature_required === true;
  return {
    publisherVerified,
    signatureVerified,
    provenanceVerified,
    signerIdentity,
    signerRevoked,
    signatureRequired,
    ownership,
  };
}

export function classifyTrust(pkg = {}, input = {}) {
  const trust = trustInputs(pkg, input);
  let level = 'unverified';
  if (trust.publisherVerified && trust.signatureVerified && !trust.signerRevoked) level = 'trusted';
  else if (trust.publisherVerified || trust.signatureVerified || trust.provenanceVerified) level = 'verified';
  else if (pkg.security?.signature || pkg.security?.provenance || pkg.security?.sbom || pkg.publisher) level = 'community';
  return Object.freeze({
    level,
    publisher_verified: trust.publisherVerified,
    cryptographic_signature_verified: trust.signatureVerified,
    slsa_provenance_verified: trust.provenanceVerified,
    signer_identity: trust.signerIdentity,
    signer_revoked: trust.signerRevoked,
    repository_ownership: trust.ownership,
  });
}

export function evaluatePackagePolicy(input = {}) {
  const pkg = input.package && typeof input.package === 'object' ? input.package : {};
  const operation = clean(input.operation) || 'inspect';
  const type = pkg.type ? normalizePackageType(pkg.type) : null;
  const id = pkg.id ? normalizePackageId(pkg.id) : null;
  const key = type && id ? packageKey(type, id) : null;
  const security = releaseSecurity(pkg, input);
  const trust = classifyTrust(pkg, input);
  const permissions = permissionNames(input.permissions ?? pkg.permissions);
  const registry = registryIdentity(input);
  const critical = criticalAdvisories(pkg, input);
  const reasons = [];
  const warnings = [];

  if (security.revoked === true || pkg.revoked === true) reasons.push('release-revoked');
  if (trust.signer_revoked) reasons.push('signer-revoked');
  if (LOAD_OPERATIONS.has(operation) && critical.length) reasons.push('critical-advisory');
  if (LOAD_OPERATIONS.has(operation) && (security.yanked === true || pkg.yanked === true)) reasons.push('release-yanked');
  if (LOAD_OPERATIONS.has(operation) && (input.compatibility?.compatible === false || input.environment?.compatible === false)) reasons.push('runtime-incompatible');
  if (LOAD_OPERATIONS.has(operation) && trust.signatureRequired && !trust.signatureVerified) reasons.push('required-signature-not-verified');

  if (reasons.length) {
    return Object.freeze({
      decision: POLICY_DECISIONS.DENY,
      operation,
      package_key: key,
      trust,
      registry,
      required_permissions: permissions,
      reasons: Object.freeze(reasons),
      warnings: Object.freeze(warnings),
      evaluated_at: new Date().toISOString(),
    });
  }

  if (!registry.trusted) warnings.push('registry-not-trusted');
  if (trust.level !== 'trusted' && LOAD_OPERATIONS.has(operation)) warnings.push(`package-trust-${trust.level}`);
  if (permissions.length) warnings.push('package-permissions-declared');

  const approvalRequired = MUTATION_OPERATIONS.has(operation)
    && input.approved !== true
    && input.dry_run !== true;

  return Object.freeze({
    decision: approvalRequired || (!registry.trusted && LOAD_OPERATIONS.has(operation) && input.approved !== true)
      ? POLICY_DECISIONS.REQUIRE_CONFIRMATION
      : POLICY_DECISIONS.ALLOW,
    operation,
    package_key: key,
    trust,
    registry,
    required_permissions: permissions,
    reasons: Object.freeze([]),
    warnings: Object.freeze(warnings),
    evaluated_at: new Date().toISOString(),
  });
}

export function assertPolicyAllowed(input = {}) {
  const decision = evaluatePackagePolicy(input);
  if (decision.decision === POLICY_DECISIONS.ALLOW) return decision;
  const error = new Error(
    decision.decision === POLICY_DECISIONS.REQUIRE_CONFIRMATION
      ? `explicit local approval is required for ${decision.operation}${decision.package_key ? `: ${decision.package_key}` : ''}`
      : `package policy denied ${decision.operation}${decision.package_key ? `: ${decision.package_key}` : ''}${decision.reasons.length ? ` (${decision.reasons.join(', ')})` : ''}`,
  );
  error.code = decision.decision === POLICY_DECISIONS.REQUIRE_CONFIRMATION ? 'DSH_PERMISSION_DENIED' : 'DSH_POLICY_DENIED';
  error.policy = decision;
  throw error;
}

export function compactPolicySnapshot(decision) {
  if (!decision) return null;
  return Object.freeze({
    decision: decision.decision,
    operation: decision.operation,
    package_key: decision.package_key || null,
    trust: decision.trust || null,
    registry: decision.registry || null,
    required_permissions: [...(decision.required_permissions || [])],
    reasons: [...(decision.reasons || [])],
    warnings: [...(decision.warnings || [])],
    evaluated_at: decision.evaluated_at || new Date().toISOString(),
  });
}
