import { access, mkdir, rm, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertPackageType, safePackageId } from './package-model.mjs';
import { packageRoot, pluginRoot } from './registry.mjs';
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

const exec = promisify(execFile);
const DEFAULT_GIT_TIMEOUT_MS = 120_000;

export function defaultPluginHome() {
  return pluginRoot();
}

export function defaultPackageHome(type) {
  return packageRoot(assertPackageType(type));
}

async function git(args, cwd, options = {}) {
  const configuredTimeout = Number(options.timeoutMs ?? process.env.DSH_GIT_TIMEOUT_MS);
  const timeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : DEFAULT_GIT_TIMEOUT_MS;
  return exec('git', args, {
    cwd,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    timeout,
    killSignal: 'SIGTERM',
  });
}

function assertNotYanked(pkg) {
  if (pkg?.security?.yanked !== true) return;
  const error = new Error(`runtime package is yanked and cannot be installed: ${pkg.type || 'plugin'}:${pkg.id}@${pkg.version}`);
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
  return ['sigstore', 'slsa']
    .map((kind) => report.identity[kind])
    .filter((item) => item?.declared && item.valid === false)
    .map((item) => `${item.kind}:${item.status}`);
}

function enterpriseRegistryIdentity() {
  const selectedName = String(process.env.DSH_SELECTED_REGISTRY_NAME || '').trim();
  if (selectedName) {
    return {
      name: selectedName,
      url: String(process.env.DSH_SELECTED_REGISTRY_URL || '').trim() || null,
      trusted: process.env.DSH_SELECTED_REGISTRY_TRUSTED === '1',
      organization: String(process.env.DSH_SELECTED_REGISTRY_ORGANIZATION || '').trim() || null,
    };
  }
  const registryIndex = process.argv.indexOf('--registry');
  const directRegistry = registryIndex >= 0 ? String(process.argv[registryIndex + 1] || '').trim() : '';
  if (directRegistry) return { name: directRegistry, url: directRegistry, trusted: false, organization: null };
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

export async function installPackage(inputPackage, options = {}) {
  const type = assertPackageType(inputPackage?.type || 'plugin');
  assertNotYanked({ ...inputPackage, type });
  assertPackageSecurityAllowed({ ...inputPackage, type });
  const sourceVerification = verifyResolvedPackage({ ...inputPackage, type });
  if (!sourceVerification.ok) throw new Error('runtime package verification failed: ' + sourceVerification.errors.join('; '));

  let pkg = inputPackage;
  // A dry-run must be deterministic and side-effect free. Release discovery
  // performs a network lookup, so defer it to the real install path; the
  // caller can still explicitly provide a release artifact when planning.
  if (!options.dryRun && !isReleaseArtifact(pkg.artifact) && options.releaseDiscovery !== false && !options.repositoryUrl) {
    const discovered = await discoverReleaseArtifact({ ...pkg, type }, {
      timeout: options.releaseDiscoveryTimeout,
      strict: options.releaseDiscoveryStrict === true,
    });
    if (discovered) pkg = { ...pkg, artifact: { ...pkg.artifact, ...discovered } };
  }
  assertPackageSecurityAllowed({ ...pkg, type });
  const verification = verifyResolvedPackage({ ...pkg, type });
  if (!verification.ok) throw new Error('runtime package verification failed: ' + verification.errors.join('; '));

  const compatibility = assertCompatibility(pkg, options.environment);
  const permissions = inspectPermissions(pkg.permissions);
  const registryContext = enterpriseRegistryIdentity();
  const locallyApproved = options.approved === true || options.dryRun === true || process.env.DSH_PERMISSION_APPROVED === '1';
  await enforceEnterprisePolicy({
    package: { ...pkg, type },
    publisher: pkg.publisher,
    permissions: pkg.permissions,
    registry: registryContext,
    approved: locallyApproved,
    operation: options.force ? 'replace' : 'install',
  }, { file: options.enterprisePolicyFile });
  if (!options.dryRun) {
    assertPermissionConsent(pkg.permissions, {
      approved: locallyApproved,
    });
  }

  const root = resolve(options.root || defaultPackageHome(type));
  const target = join(root, safePackageId(pkg.id));
  const backup = target + '.backup';
  const evidenceDeclared = hasDeclaredSupplyChainEvidence(pkg.security);
  const releaseArtifact = isReleaseArtifact(pkg.artifact);
  const installSource = releaseArtifact ? 'release-archive' : 'git-source';
  const plan = {
    id: pkg.id,
    type,
    version: pkg.version,
    channel: pkg.channel || 'stable',
    repo: pkg.repo,
    commit: pkg.commit,
    target,
    backup,
    source_registry: registryContext.name,
    source_registry_url: registryContext.url,
    source_registry_trusted: registryContext.trusted === true,
    source_registry_organization: registryContext.organization,
    install_source: installSource,
    artifact_url: releaseArtifact ? pkg.artifact.url : null,
    artifact_digest: releaseArtifact ? pkg.artifact.digest : null,
    release_tag: releaseArtifact ? pkg.artifact.release_tag || null : null,
    restart_required: true,
    compatibility,
    permissions,
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
      await mkdir(temp, { recursive: true });
      await git(['init', '-q'], temp, options);
      await git(['remote', 'add', 'origin', options.repositoryUrl || 'https://github.com/' + pkg.repo + '.git'], temp, options);
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

    const lock = {
      registry_version: 3,
      runtime_registry_version: 3,
      id: pkg.id,
      type,
      package_type: type,
      version: pkg.version,
      channel: pkg.channel || 'stable',
      source: sourceWithRegistryProvenance(pkg.source, registryContext),
      source_registry: registryContext.name,
      source_registry_url: registryContext.url,
      source_registry_trusted: registryContext.trusted === true,
      source_registry_organization: registryContext.organization,
      artifact: pkg.artifact,
      installation: {
        source: installSource,
        artifact_digest_verified: artifactVerification?.verified === true,
        artifact_digest: artifactVerification?.digest || null,
        artifact_url: artifactVerification?.url || null,
        verified_at: new Date().toISOString(),
      },
      runtime: pkg.runtime,
      capabilities: pkg.capabilities || [],
      dependencies: pkg.dependencies || [],
      permissions: pkg.permissions || [],
      permission_policy: pkg.permission_policy || null,
      permission_manifest: pkg.permission_manifest || null,
      compatibility: pkg.compatibility || {},
      publisher: pkg.publisher || null,
      security: pkg.security || null,
      supply_chain_verification: compactEvidence,
      conflicts: pkg.conflicts || [],
      replaces: pkg.replaces || [],
      provides: pkg.provides || [],
      type_config: pkg.type_config || null,
      installed_at: new Date().toISOString(),
      restart_required: true,
    };
    await writeFile(join(temp, '.dsh-install.json'), JSON.stringify(lock, null, 2) + '\n', 'utf8');

    if (options.force) {
      await rm(backup, { recursive: true, force: true });
      try {
        await rename(target, backup);
        backupMoved = true;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
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

export async function installPlugin(plugin, options = {}) {
  return installPackage({ ...plugin, type: 'plugin' }, options);
}
