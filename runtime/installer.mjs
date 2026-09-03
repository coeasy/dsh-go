import { access, mkdir, rm, rename, writeFile } from 'node:fs/promises';
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

const exec = promisify(execFile);

export function defaultPluginHome() {
  return pluginRoot();
}

export function defaultPackageHome(type) {
  return packageRoot(assertPackageType(type));
}

async function git(args, cwd) {
  return exec('git', args, { cwd, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
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

export async function installPackage(inputPackage, options = {}) {
  const type = assertPackageType(inputPackage?.type || 'plugin');
  assertNotYanked({ ...inputPackage, type });
  assertPackageSecurityAllowed({ ...inputPackage, type });
  const sourceVerification = verifyResolvedPackage({ ...inputPackage, type });
  if (!sourceVerification.ok) throw new Error('runtime package verification failed: ' + sourceVerification.errors.join('; '));

  let pkg = inputPackage;
  if (!isReleaseArtifact(pkg.artifact) && options.releaseDiscovery !== false && !options.repositoryUrl) {
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
  if (!options.dryRun) {
    assertPermissionConsent(pkg.permissions, {
      approved: options.approved === true || process.env.DSH_PERMISSION_APPROVED === '1',
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

  await mkdir(root, { recursive: true });
  const temp = target + '.tmp-' + process.pid + '-' + Date.now();
  await rm(temp, { recursive: true, force: true });

  try {
    let artifactVerification = null;
    if (releaseArtifact) {
      artifactVerification = await installReleaseArtifact(pkg.artifact, temp, {
        timeout: options.artifactTimeout,
      });
    } else {
      await mkdir(temp, { recursive: true });
      await git(['init', '-q'], temp);
      await git(['remote', 'add', 'origin', options.repositoryUrl || 'https://github.com/' + pkg.repo + '.git'], temp);
      await git(['fetch', '--depth', '1', 'origin', pkg.commit], temp);
      await git(['checkout', '--detach', '-q', 'FETCH_HEAD'], temp);
      await verifyInstalledCommit(temp, pkg.commit);
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
      source: pkg.source,
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
      backup: options.force ? backup : undefined,
    };
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    try {
      await access(backup);
      await rm(target, { recursive: true, force: true });
      await rename(backup, target);
    } catch {
      // No previous installation to restore.
    }
    throw error;
  }
}

export async function installPlugin(plugin, options = {}) {
  return installPackage({ ...plugin, type: 'plugin' }, options);
}
