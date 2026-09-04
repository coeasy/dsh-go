import { access } from 'node:fs/promises';
import { discoverPackageManifest } from './bindings.mjs';
import { normalizePackageRequest, normalizePackageType, packageKey } from '../packages/protocol-core/index.mjs';
import { readInstallLock, verifyInstalledCommit } from './verifier.mjs';
import { hasDeclaredSupplyChainEvidence, verifySecurityEvidence } from './supply-chain-verifier.mjs';
import { verifySupplyChainIdentity } from './supply-chain-identity.mjs';
import { isReleaseArtifact } from './artifact-installer.mjs';
import { verifyCasSnapshot } from './cas-store.mjs';

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

function dependencyRequest(value) {
  if (typeof value === 'string') {
    const colon = value.indexOf(':');
    if (colon <= 0) throw new Error(`dependency must use explicit type:id syntax: ${value}`);
    const type = value.slice(0, colon);
    const body = value.slice(colon + 1);
    const at = body.lastIndexOf('@');
    return normalizePackageRequest({ type, id: at > 0 ? body.slice(0, at) : body, range: at > 0 ? body.slice(at + 1) : '*' });
  }
  return normalizePackageRequest({
    type: value?.type,
    id: value?.id,
    range: value?.range || '*',
    channel: value?.channel || 'stable',
  });
}

export function checkRuntimeRecordHealth(pkg) {
  let type = false;
  try { normalizePackageType(pkg?.type); type = true; } catch { type = false; }
  const checks = {
    type,
    id: Boolean(pkg?.id),
    version: Boolean(pkg?.version),
    source: Boolean(pkg?.commit || pkg?.source?.commit),
    state: Boolean(pkg?.state && pkg.state !== 'removed'),
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  return { status: failed.length ? 'failed' : 'healthy', checks, failed, warnings: [], checked_at: new Date().toISOString() };
}

export async function checkRuntimePackageHealth(pkg, options = {}) {
  const type = normalizePackageType(pkg?.type);
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
      checks.lock = false; checks.lock_type = false; checks.lock_id = false; checks.lock_version = false;
    }
  } else {
    checks.lock = false; checks.lock_type = false; checks.lock_id = false; checks.lock_version = false;
  }

  if (lock && options.verifyCommit !== false) {
    if (isReleaseArtifact(lock.artifact)) {
      const expected = String(lock.artifact?.digest || '').toLowerCase();
      const verified = String(lock.installation?.artifact_digest || '').toLowerCase();
      checks.commit = Boolean(lock.source?.commit && lock.installation?.artifact_digest_verified === true && expected && verified === expected);
      checks.artifact = checks.commit;
    } else {
      try { await verifyInstalledCommit(target, lock.source.commit); checks.commit = true; }
      catch { checks.commit = false; }
      checks.artifact = true;
    }
  } else {
    checks.commit = Boolean(lock); checks.artifact = Boolean(lock);
  }

  const contentDigest = lock?.content_digest || lock?.content?.digest || pkg?.content_digest || pkg?.content?.digest || null;
  if (contentDigest) {
    try { checks.cas = (await verifyCasSnapshot(contentDigest, { root: options.storeRoot })).ok; }
    catch { checks.cas = false; }
  } else checks.cas = true;

  let manifest = null;
  if (target) {
    try { manifest = await discoverPackageManifest(target, type); } catch { manifest = null; }
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
        if (!['digest-mismatch', 'verification-error'].includes(evidence.status)) warnings.push(`supply-chain:${evidence.kind}:${evidence.status}`);
      }
      for (const identityCheck of [identity.sigstore, identity.slsa]) {
        if (!identityCheck?.declared || identityCheck.verified || identityCheck.valid === false) continue;
        warnings.push(`supply-chain:${identityCheck.kind}:${identityCheck.status}`);
      }
      if (security.signature && !supplyChain.cryptographic_signature_verified) warnings.push('supply-chain:signature:cryptographic-verification-pending');
    } catch (error) {
      checks.supply_chain = false;
      supplyChain = { valid: false, error: error instanceof Error ? error.message : String(error) };
    }
  } else checks.supply_chain = true;

  const runtimePackages = options.runtimeRegistry?.packages;
  if (Array.isArray(runtimePackages)) {
    const dependencies = (pkg.dependencies || []).map(dependencyRequest);
    const missing = dependencies.filter((dependency) => {
      const key = packageKey(dependency.type, dependency.id);
      return !runtimePackages.some((entry) => packageKey(entry.type, entry.id) === key && !['removed', 'failed'].includes(entry.state));
    });
    checks.dependencies = missing.length === 0;
    if (missing.length) warnings.push(...missing.map((dependency) => `dependency:${packageKey(dependency.type, dependency.id)}`));
  }

  const critical = ['type', 'id', 'version', 'source', 'state', 'path', 'lock', 'lock_type', 'lock_id', 'lock_version', 'commit', 'artifact', 'cas', 'supply_chain'];
  const failed = critical.filter((name) => checks[name] === false);
  return {
    status: failed.length ? 'failed' : warnings.length ? 'warning' : 'healthy',
    checks, failed, warnings, supply_chain: supplyChain, checked_at: new Date().toISOString(),
  };
}

export async function checkRuntimeHealth(pkg, options = {}) {
  return checkRuntimePackageHealth(pkg, options);
}

export async function healthSummary(records = [], options = {}) {
  return Promise.all(records.map(async (record) => ({ id: record.id, type: record.type, health: await checkRuntimePackageHealth(record, options) })));
}
