import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { runtimeRoot } from './registry.mjs';
import { withFileLock } from './file-lock.mjs';

export const TRUST_ROOT_SCHEMA_VERSION = 1;

export function trustRootPath() {
  return resolve(process.env.DSH_TRUST_ROOT || join(runtimeRoot(), 'trust', 'trust-root.json'));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function defaultTrustRoot() {
  return {
    schema_version: TRUST_ROOT_SCHEMA_VERSION,
    publishers: [],
    revoked_signers: [],
    accepted_issuers: [],
  };
}

export function trustRootRevision(root) {
  const payload = {
    schema_version: TRUST_ROOT_SCHEMA_VERSION,
    publishers: root.publishers || [],
    revoked_signers: root.revoked_signers || [],
    accepted_issuers: root.accepted_issuers || [],
  };
  return createHash('sha256').update(JSON.stringify(stable(payload))).digest('hex');
}

export function validateTrustRoot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('trust root must be an object');
  if (value.schema_version !== TRUST_ROOT_SCHEMA_VERSION) throw new Error(`unsupported trust root schema: ${value.schema_version}`);
  const publishers = Array.isArray(value.publishers) ? value.publishers : [];
  const revokedSigners = Array.isArray(value.revoked_signers) ? value.revoked_signers.map((item) => String(item).trim()).filter(Boolean) : [];
  const acceptedIssuers = Array.isArray(value.accepted_issuers) ? value.accepted_issuers.map((item) => String(item).trim()).filter(Boolean) : [];
  const seen = new Set();
  for (const publisher of publishers) {
    const id = String(publisher?.id || '').trim().toLowerCase();
    if (!id) throw new Error('trust root publisher id is required');
    if (seen.has(id)) throw new Error(`duplicate trust root publisher: ${id}`);
    seen.add(id);
  }
  return {
    schema_version: TRUST_ROOT_SCHEMA_VERSION,
    publishers,
    revoked_signers: [...new Set(revokedSigners)].sort(),
    accepted_issuers: [...new Set(acceptedIssuers)].sort(),
    revision: trustRootRevision({ schema_version: TRUST_ROOT_SCHEMA_VERSION, publishers, revoked_signers: revokedSigners, accepted_issuers: acceptedIssuers }),
  };
}

export async function readTrustRoot(file = trustRootPath()) {
  try {
    return validateTrustRoot(JSON.parse(await readFile(file, 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT') return validateTrustRoot(defaultTrustRoot());
    throw error;
  }
}

export async function writeTrustRoot(value, file = trustRootPath()) {
  const target = resolve(file);
  const normalized = validateTrustRoot({ ...value, schema_version: TRUST_ROOT_SCHEMA_VERSION });
  const persisted = {
    schema_version: TRUST_ROOT_SCHEMA_VERSION,
    publishers: normalized.publishers,
    revoked_signers: normalized.revoked_signers,
    accepted_issuers: normalized.accepted_issuers,
  };
  await mkdir(dirname(target), { recursive: true });
  return withFileLock(`${target}.lock`, async () => {
    const temp = `${target}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
    try {
      await writeFile(temp, `${JSON.stringify(persisted, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {});
      throw error;
    }
    return { file: target, revision: normalized.revision, trust_root: normalized };
  });
}

function clean(value) {
  const text = String(value || '').trim();
  return text || null;
}

function sigstoreIdentity(verification = {}, pkg = {}) {
  return clean(
    verification.identity?.sigstore?.identity
      || verification.identity?.identity
      || verification.signer_identity
      || pkg.security?.signature?.identity,
  );
}

function sigstoreIssuer(verification = {}, pkg = {}) {
  return clean(
    verification.identity?.sigstore?.issuer
      || verification.identity?.issuer
      || verification.signer_issuer
      || pkg.security?.signature?.issuer
      || pkg.security?.signature?.oidc_issuer,
  );
}

export async function createReleaseTrustSnapshot(pkg = {}, verification = {}, options = {}) {
  const root = options.trustRoot || await readTrustRoot(options.trustRootFile || trustRootPath());
  const publisherId = clean(pkg.publisher?.id || pkg.publisher_id)?.toLowerCase() || null;
  const rootPublisher = publisherId ? root.publishers.find((item) => String(item.id || '').toLowerCase() === publisherId) : null;
  const ownership = pkg.publisher?.repository_ownership || rootPublisher?.repository_ownership || null;
  const publisherVerified = pkg.publisher?.verified === true || ownership === 'verified' || rootPublisher?.verified === true;
  const signatureVerified = verification.cryptographic_signature_verified === true
    || verification.identity?.cryptographic_signature_verified === true;
  const provenanceVerified = verification.slsa_provenance_verified === true
    || verification.identity?.slsa_provenance_verified === true;
  const signerIdentity = sigstoreIdentity(verification, pkg);
  const signerIssuer = sigstoreIssuer(verification, pkg);
  const revoked = signerIdentity ? root.revoked_signers.includes(signerIdentity) : false;
  const issuerAccepted = !root.accepted_issuers.length || (signerIssuer ? root.accepted_issuers.includes(signerIssuer) : false);
  const trusted = publisherVerified && signatureVerified && !revoked && issuerAccepted;
  return {
    schema_version: 1,
    trust_level: trusted ? 'trusted' : (publisherVerified || signatureVerified || provenanceVerified ? 'verified' : 'unverified'),
    trusted,
    publisher_id: publisherId,
    publisher_verified: publisherVerified,
    repository_ownership: ownership,
    cryptographic_signature_verified: signatureVerified,
    slsa_provenance_verified: provenanceVerified,
    signer_identity: signerIdentity,
    signer_issuer: signerIssuer,
    signer_revoked: revoked,
    issuer_accepted: issuerAccepted,
    trust_root_revision: root.revision || trustRootRevision(root),
    verified_at: new Date().toISOString(),
  };
}
