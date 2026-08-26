import { access } from 'node:fs/promises';
import { discoverPackageManifest } from './bindings.mjs';
import { assertPackageType, normalizePackageDependency, packageKey } from './package-model.mjs';
import { readInstallLock, verifyInstalledCommit } from './verifier.mjs';
import { hasDeclaredSupplyChainEvidence, verifySecurityEvidence } from './supply-chain-verifier.mjs';
import { verifySupplyChainIdentity } from './supply-chain-identity.mjs';

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function checkRuntimeRecordHealth(pkg) {
  let type = false;
  try {
    assertPackageType(pkg?.type || 'plugin');
    type = true;
  } catch {
    type = false;
  }
  const checks = {
    type,
    id: Boolean(pkg?.id),
    version: Boolean(pkg?.version),
    source: Boolean(pkg?.commit || pkg?.source?.commit),
    state: Boolean(pkg?.state && pkg.state !== 'removed'),
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  return {
    status: failed.length ? 'failed' : 'healthy',
    checks,
    failed,
    warnings: [],
    checked_at: new Date().toISOString(),
  };
}

export async function checkRuntimePackageHealth(pkg, options = {}) {
  const type = assertPackageType(pkg?.type || 'plugin');
  const base = checkRuntimeRecordHealth({ ...pkg, type });
  const checks = { ...base.checks };
  const warnings = [];
  const target = pkg?.path;
  checks.path = Boolean(target && await exists(target));

  let lock = null;
  if (checks.path) {
    try {
      lock = await readInstallLock(target);
      checks.lock = true;
      checks.lock_type = lock.type === type;
      checks.lock_id = lock.id === pkg.id;
      checks.lock_version = lock.version === pkg.version;
    } catch {
      checks.lock = false;
      checks.lock_type = false;
      checks.lock_id = false;
      checks.lock_version = false;
    }
  } else {
    checks.lock = false;
    checks.lock_type = false;
    checks.lock_id = false;
    checks.lock_version = false;
  }

  if (lock && options.verifyCommit !== false) {
    try {
      await verifyInstalledCommit(target, lock.source.commit);
      checks.commit = true;
    } catch {
      checks.commit = false;
    }
  } else {
    checks.commit = Boolean(lock);
  }

  let manifest = null;
  if (target) {
    try {
      manifest = await discoverPackageManifest(target, type);
    } catch {
      manifest = null;
    }
  }
  checks.manifest = Boolean(manifest?.file);
  if (!checks.manifest) warnings.push('manifest');

  let supplyChain = null;
  const security = lock?.security || pkg?.security || {};
  if (checks.path && hasDeclaredSupplyChainEvidence(security)) {
    try {
      supplyChain = await verifySecurityEvidence(security, { root: target, online: false });
      const identity = await verifySupplyChainIdentity(security, supplyChain, {
        root: target,
        cosignPath: options.cosignPath,
        cosignRunner: options.cosignRunner,
        hostEnv: options.hostEnv,
      });
      supplyChain.identity = identity;
      supplyChain.cryptographic_signature_verified = identity.cryptographic_signature_verified === true;
      supplyChain.slsa_provenance_verified = identity.slsa_provenance_verified === true;
      supplyChain.valid = supplyChain.valid === true && identity.valid === true;
      checks.supply_chain = supplyChain.valid === true;
      for (const evidence of supplyChain.evidence || []) {
        if (!evidence.declared || evidence.verified) continue;
        if (!['digest-mismatch', 'verification-error'].includes(evidence.status)) {
          warnings.push(`supply-chain:${evidence.kind}:${evidence.status}`);
        }
      }
      for (const identityCheck of [identity.sigstore, identity.slsa]) {
        if (!identityCheck?.declared || identityCheck.verified) continue;
        if (identityCheck.valid === false) continue;
        warnings.push(`supply-chain:${identityCheck.kind}:${identityCheck.status}`);
      }
      if (security.signature && !supplyChain.cryptographic_signature_verified) {
        warnings.push('supply-chain:signature:cryptographic-verification-pending');
      }
    } catch (error) {
      checks.supply_chain = false;
      supplyChain = {
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  } else {
    checks.supply_chain = true;
  }

  const runtimePackages = options.runtimeRegistry?.packages || options.runtimeRegistry?.plugins;
  if (Array.isArray(runtimePackages)) {
    const dependencies = (pkg.dependencies || []).map((item) => normalizePackageDependency(item, 'plugin'));
    const missing = dependencies.filter((dependency) => {
      const key = packageKey(dependency.type, dependency.id);
      return !runtimePackages.some((entry) =>
        packageKey(entry.type || 'plugin', entry.id) === key && !['removed', 'failed'].includes(entry.state));
    });
    checks.dependencies = missing.length === 0;
    if (missing.length) warnings.push(...missing.map((dependency) => `dependency:${packageKey(dependency.type, dependency.id)}`));
  }

  const critical = ['type', 'id', 'version', 'source', 'state', 'path', 'lock', 'lock_type', 'lock_id', 'lock_version', 'commit', 'supply_chain'];
  const failed = critical.filter((name) => checks[name] === false);
  return {
    status: failed.length ? 'failed' : warnings.length ? 'warning' : 'healthy',
    checks,
    failed,
    warnings,
    supply_chain: supplyChain,
    checked_at: new Date().toISOString(),
  };
}

export async function checkRuntimeHealth(plugin, options = {}) {
  return checkRuntimePackageHealth({ ...plugin, type: plugin?.type || 'plugin' }, options);
}

export async function healthSummary(records = [], options = {}) {
  return Promise.all(records.map(async (record) => ({
    id: record.id,
    type: record.type || 'plugin',
    health: await checkRuntimePackageHealth(record, options),
  })));
}
