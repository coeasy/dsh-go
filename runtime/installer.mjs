import { access, mkdir, rm, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizePackageId, normalizePackageType } from '../packages/protocol-core/index.mjs';
import { assertPolicyAllowed, compactPolicySnapshot } from '../packages/policy-core/index.mjs';
import { packageRoot } from './registry.mjs';
import { verifyInstalledCommit, verifyResolvedPackage } from './verifier.mjs';
import { assertCompatibility } from './compatibility.mjs';
import { assertPermissionConsent, inspectPermissions } from './permissions.mjs';
import { assertPackageSecurityAllowed } from './advisory.mjs';
import { hasDeclaredSupplyChainEvidence, verifySecurityEvidence } from './supply-chain-verifier.mjs';
import { verifySupplyChainIdentity } from './supply-chain-identity.mjs';
import { installReleaseArtifact, isReleaseArtifact } from './artifact-installer.mjs';
import { discoverReleaseArtifact } from './release-discovery.mjs';
import { enforceEnterprisePolicy } from './enterprise-policy.mjs';
import { withPackageOperationLock } from './package-operation-lock.mjs';
import { copyCasSnapshot, snapshotDirectory } from './cas-store.mjs';
import { createReleaseTrustSnapshot } from './trust-store.mjs';
import { getRuntimeAdapter } from './adapters/index.mjs';

const exec = promisify(execFile);
const DEFAULT_GIT_TIMEOUT_MS = 120_000;

export function defaultPackageHome(type) {
  return packageRoot(normalizePackageType(type));
}

async function git(args, cwd, options = {}) {
  const configuredTimeout = Number(options.timeoutMs ?? process.env.DSH_GIT_TIMEOUT_MS);
  const timeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : DEFAULT_GIT_TIMEOUT_MS;
  return exec('git', args, { cwd, windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout, killSignal: 'SIGTERM' });
}

function assertNotYanked(pkg) {
  if (pkg?.security?.yanked !== true && pkg?.yanked !== true) return;
  const error = new Error(`runtime package is yanked and cannot be installed: ${pkg.type}:${pkg.id}@${pkg.version}`);
  error.code = 'DSH_PACKAGE_YANKED';
  throw error;
}

function compactEvidenceReport(report) {
  if (!report) return null;
  return {
    checked_at: new Date().toISOString(),
    online: report.online === true,
    valid: report.valid === true,
    cryptographic_signature_verified: report.cryptographic_signature_verified === true,
    slsa_provenance_verified: report.slsa_provenance_verified === true,
    summary: report.summary,
    identity: report.identity || null,
    evidence: (report.evidence || []).filter((item) => item.declared).map((item) => ({
      kind: item.kind,
      status: item.status,
      verified: item.verified === true,
      expected_sha256: item.expected_sha256 || null,
      actual_sha256: item.actual_sha256 || null,
      reason: item.reason || null,
    })),
  };
}

function identityFailures(report) {
  if (!report?.identity) return [];
  return ['sigstore', 'slsa'].map((kind) => report.identity[kind]).filter((item) => item?.declared && item.valid === false).map((item) => `${item.kind}:${item.status}`);
}

function enterpriseRegistryIdentity(options = {}) {
  if (options.registryIdentity && typeof options.registryIdentity === 'object') return {
    name: String(options.registryIdentity.name || 'official'),
    url: options.registryIdentity.url || null,
    trusted: options.registryIdentity.trusted !== false,
    organization: options.registryIdentity.organization || null,
  };
  const selectedName = String(process.env.DSH_SELECTED_REGISTRY_NAME || '').trim();
  if (selectedName) {
    return {
      name: selectedName,
      url: String(process.env.DSH_SELECTED_REGISTRY_URL || '').trim() || null,
      trusted: process.env.DSH_SELECTED_REGISTRY_TRUSTED === '1',
      organization: String(process.env.DSH_SELECTED_REGISTRY_ORGANIZATION || '').trim() || null,
    };
  }
  return { name: 'official', url: null, trusted: true, organization: null };
}

function sourceWithRegistryProvenance(source, registry) {
  return {
    ...source,
    registry: registry.name,
    registry_url: registry.url || null,
    registry_trusted: registry.trusted === true,
    registry_organization: registry.organization || null,
  };
}

function canonicalPackage(inputPackage) {
  if (!inputPackage?.type) throw new Error('runtime package type is required');
  const type = normalizePackageType(inputPackage.type);
  const id = normalizePackageId(inputPackage.id);
  const version = String(inputPackage.version || '').trim();
  if (!version) throw new Error(`runtime package version is required: ${type}:${id}`);
  const source = { ...(inputPackage.source || {}) };
  const repo = String(source.repo || inputPackage.repo || '').trim().toLowerCase();
  const commit = String(source.commit || inputPackage.commit || '').trim().toLowerCase();
  return { ...inputPackage, type, id, version, source: { ...source, repo, commit }, repo, commit };
}

export async function installPackage(inputPackage, options = {}) {
  let pkg = canonicalPackage(inputPackage);
  const type = pkg.type;
  assertNotYanked(pkg);
  assertPackageSecurityAllowed(pkg);
  const sourceVerification = verifyResolvedPackage(pkg);
  if (!sourceVerification.ok) throw new Error(`runtime package verification failed: ${sourceVerification.errors.join('; ')}`);

  if (!options.dryRun && !isReleaseArtifact(pkg.artifact) && options.releaseDiscovery !== false && !options.repositoryUrl) {
    const discovered = await discoverReleaseArtifact(pkg, { timeout: options.releaseDiscoveryTimeout, strict: options.releaseDiscoveryStrict === true });
    if (discovered) pkg = canonicalPackage({ ...pkg, artifact: { ...pkg.artifact, ...discovered } });
  }

  assertPackageSecurityAllowed(pkg);
  const verification = verifyResolvedPackage(pkg);
  if (!verification.ok) throw new Error(`runtime package verification failed: ${verification.errors.join('; ')}`);
  const compatibility = assertCompatibility(pkg, options.environment);
  const permissions = inspectPermissions(pkg.permissions);
  const registryContext = enterpriseRegistryIdentity(options);
  const locallyApproved = options.approved === true || options.dryRun === true || process.env.DSH_PERMISSION_APPROVED === '1';
  await enforceEnterprisePolicy({
    package: pkg,
    publisher: pkg.publisher,
    permissions: pkg.permissions,
    registry: registryContext,
    approved: locallyApproved,
    operation: options.force ? 'replace' : 'install',
  }, { file: options.enterprisePolicyFile });
  if (!options.dryRun) assertPermissionConsent(pkg.permissions, { approved: locallyApproved });

  const root = resolve(options.root || defaultPackageHome(type));
  const target = join(root, ...pkg.id.split('/'));
  const backup = `${target}.backup`;
  const evidenceDeclared = hasDeclaredSupplyChainEvidence(pkg.security);
  const releaseArtifact = isReleaseArtifact(pkg.artifact);
  const installSource = releaseArtifact ? 'release-archive' : 'git-source';
  const adapter = getRuntimeAdapter(type);
  const plan = {
    key: `${type}:${pkg.id}`,
    id: pkg.id,
    type,
    version: pkg.version,
    channel: pkg.channel || 'stable',
    repo: pkg.repo,
    commit: pkg.commit,
    target,
    backup,
    registry_revision: pkg.registry_revision || null,
    resolution_hash: pkg.resolution_hash || null,
    source_registry: registryContext.name,
    source_registry_url: registryContext.url,
    source_registry_trusted: registryContext.trusted === true,
    source_registry_organization: registryContext.organization,
    install_source: installSource,
    artifact_url: releaseArtifact ? pkg.artifact.url : null,
    artifact_digest: releaseArtifact ? (pkg.artifact.digest || pkg.artifact.integrity || null) : null,
    restart_required: true,
    compatibility,
    permissions,
    adapter: { type: adapter.type, abi_version: adapter.abi_version },
    supply_chain: { declared: evidenceDeclared, checked: false, valid: null },
  };
  if (options.dryRun) return plan;

  return withPackageOperationLock(type, pkg.id, async () => {
    await mkdir(root, { recursive: true });
    const temp = `${target}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
    await rm(temp, { recursive: true, force: true });
    let backupMoved = false;
    let targetCommitted = false;

    try {
      let artifactVerification = null;
      if (releaseArtifact) {
        artifactVerification = await installReleaseArtifact(pkg.artifact, temp, {
          timeout: options.artifactTimeout,
          maxBytes: options.artifactMaxBytes,
          commandTimeout: options.artifactCommandTimeout,
        });
      } else {
        if (!pkg.repo || !pkg.commit) throw new Error(`immutable git source is required: ${type}:${pkg.id}@${pkg.version}`);
        await mkdir(temp, { recursive: true });
        await git(['init', '-q'], temp, options);
        await git(['remote', 'add', 'origin', options.repositoryUrl || `https://github.com/${pkg.repo}.git`], temp, options);
        await git(['fetch', '--depth', '1', 'origin', pkg.commit], temp, options);
        await git(['checkout', '--detach', '-q', 'FETCH_HEAD'], temp, options);
        await verifyInstalledCommit(temp, pkg.commit, options);
      }

      let evidenceReport = null;
      if (evidenceDeclared) {
        evidenceReport = await verifySecurityEvidence(pkg.security, { root: temp, online: false });
        const identity = await verifySupplyChainIdentity(pkg.security, evidenceReport, {
          root: temp,
          cosignPath: options.cosignPath,
          cosignRunner: options.cosignRunner,
          hostEnv: options.hostEnv,
        });
        evidenceReport.identity = identity;
        evidenceReport.cryptographic_signature_verified = identity.cryptographic_signature_verified === true;
        evidenceReport.slsa_provenance_verified = identity.slsa_provenance_verified === true;
        evidenceReport.valid = evidenceReport.valid === true && identity.valid === true;
        if (!evidenceReport.valid) {
          const failed = evidenceReport.evidence
            .filter((item) => ['digest-mismatch', 'verification-error'].includes(item.status))
            .map((item) => `${item.kind}:${item.status}`)
            .concat(identityFailures(evidenceReport));
          const error = new Error(`supply-chain evidence verification failed: ${failed.join(', ') || 'unknown evidence failure'}`);
          error.code = 'DSH_SUPPLY_CHAIN_EVIDENCE_INVALID';
          error.evidence = evidenceReport;
          throw error;
        }
      }
      const compactEvidence = compactEvidenceReport(evidenceReport);
      const trustSnapshot = await createReleaseTrustSnapshot(pkg, compactEvidence || {}, { trustRoot: options.trustRoot, trustRootFile: options.trustRootFile });
      const policy = assertPolicyAllowed({
        operation: options.force ? 'update' : 'install',
        package: pkg,
        publisher: pkg.publisher,
        permissions: pkg.permissions,
        security: pkg.security,
        advisories: options.advisories || [],
        verification: compactEvidence || {},
        publisher_verified: trustSnapshot.publisher_verified,
        signer_identity: trustSnapshot.signer_identity,
        signer_revoked: trustSnapshot.signer_revoked,
        compatibility: { compatible: compatibility?.compatible !== false && compatibility?.ok !== false },
        environment: options.environment || {},
        registry: registryContext,
        approved: locallyApproved,
      });
      const policySnapshot = compactPolicySnapshot(policy);

      const content = await snapshotDirectory(temp, { root: options.storeRoot });
      const lock = {
        schema_version: 4,
        runtime_state_version: 4,
        protocol_version: 2,
        id: pkg.id,
        type,
        version: pkg.version,
        channel: pkg.channel || 'stable',
        source: sourceWithRegistryProvenance(pkg.source, registryContext),
        registry_revision: pkg.registry_revision || null,
        resolution_hash: pkg.resolution_hash || null,
        artifact: pkg.artifact || {},
        installation: {
          source: installSource,
          artifact_digest_verified: artifactVerification?.verified === true,
          artifact_digest: artifactVerification?.digest || null,
          artifact_url: artifactVerification?.url || null,
          verified_at: new Date().toISOString(),
        },
        content: { algorithm: 'sha256', digest: content.digest, entries: content.entries },
        content_digest: content.digest,
        runtime: pkg.runtime || {},
        entrypoints: pkg.entrypoints || {},
        capabilities: pkg.capabilities || [],
        dependencies: pkg.dependencies || [],
        permissions: pkg.permissions || [],
        compatibility: pkg.compatibility || {},
        publisher: pkg.publisher || null,
        security: pkg.security || null,
        supply_chain_verification: compactEvidence,
        trust_snapshot: trustSnapshot,
        policy_snapshot: policySnapshot,
        adapter: { type: adapter.type, abi_version: adapter.abi_version },
        installed_at: new Date().toISOString(),
        restart_required: true,
      };

      // The verified CAS snapshot is the materialization authority. The install
      // lock is local metadata and is intentionally excluded from the content hash.
      await rm(temp, { recursive: true, force: true });
      await copyCasSnapshot(content.digest, temp, { root: options.storeRoot });
      await writeFile(join(temp, '.dsh-install.json'), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');

      if (options.force) {
        await rm(backup, { recursive: true, force: true });
        try { await rename(target, backup); backupMoved = true; }
        catch (error) { if (error?.code !== 'ENOENT') throw error; }
      } else {
        try {
          await access(target);
          throw new Error(`runtime package already installed: ${type}:${pkg.id} (use --force to replace)`);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      }

      await mkdir(dirname(target), { recursive: true });
      await rename(temp, target);
      targetCommitted = true;
      return {
        ...plan,
        content: { algorithm: 'sha256', digest: content.digest, entries: content.entries },
        content_digest: content.digest,
        trust_snapshot: trustSnapshot,
        policy_snapshot: policySnapshot,
        supply_chain_verification: compactEvidence,
        artifact_verified: artifactVerification?.verified === true,
        supply_chain: {
          declared: evidenceDeclared,
          checked: evidenceDeclared,
          valid: evidenceReport?.valid ?? null,
          summary: evidenceReport?.summary || null,
          cryptographic_signature_verified: evidenceReport?.cryptographic_signature_verified === true,
          slsa_provenance_verified: evidenceReport?.slsa_provenance_verified === true,
        },
        backup: options.force && backupMoved ? backup : undefined,
      };
    } catch (error) {
      await rm(temp, { recursive: true, force: true }).catch((cleanupError) => {
        error.filesystem_cleanup_error = cleanupError.message;
        error.recovery_required = true;
      });
      if (backupMoved && !targetCommitted) {
        try {
          await rm(target, { recursive: true, force: true });
          await rename(backup, target);
        } catch (rollbackError) {
          error.filesystem_rollback_error = rollbackError.message;
          error.recovery_required = true;
        }
      }
      throw error;
    }
  }, options);
}
