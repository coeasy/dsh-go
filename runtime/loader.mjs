import { resolve } from 'node:path';
import { normalizePackageId, normalizePackageType, packageKey } from '../packages/protocol-core/index.mjs';
import { assertPolicyAllowed, compactPolicySnapshot } from '../packages/policy-core/index.mjs';
import { recordRuntimeEvent, transitionPackage } from './lifecycle.mjs';
import { getRuntimeAdapter } from './adapters/index.mjs';
import {
  getRuntimePackage,
  packagePath,
  readRuntimeRegistry,
  updateRuntimeRegistry,
  upsertRuntimePackage,
} from './registry.mjs';
import { readInstallLock, verifyInstalledCommit } from './verifier.mjs';
import { assertCompatibility } from './compatibility.mjs';
import { withPackageOperationLock } from './package-operation-lock.mjs';

function hydrateRuntimeRecord(record, lock, target) {
  return {
    ...record,
    id: lock.id,
    type: lock.type,
    version: lock.version,
    channel: lock.channel,
    path: target,
    source: lock.source,
    commit: lock.source.commit,
    runtime: lock.runtime || {},
    entrypoints: lock.entrypoints || {},
    capabilities: lock.capabilities || [],
    dependencies: lock.dependencies || [],
    permissions: lock.permissions || [],
    compatibility: lock.compatibility || {},
    publisher: lock.publisher || null,
    security: lock.security || null,
    artifact: lock.artifact || null,
    content_digest: lock.content_digest || lock.content?.digest || record.content_digest || null,
    content: lock.content || record.content || null,
    trust_snapshot: lock.trust_snapshot || record.trust_snapshot || null,
    policy_snapshot: lock.policy_snapshot || record.policy_snapshot || null,
    adapter: lock.adapter || record.adapter || { type: lock.type, abi_version: 1 },
    supply_chain_verification: lock.supply_chain_verification || record.supply_chain_verification || null,
    resolution_hash: lock.resolution_hash || null,
    registry_revision: lock.registry_revision || null,
  };
}

function activateRuntimeRecord(record, binding) {
  if (record.enabled === false || record.state === 'disabled') {
    const error = new Error(`cannot activate disabled runtime package: ${packageKey(record.type, record.id)}`);
    error.code = 'DSH_PACKAGE_DISABLED';
    throw error;
  }
  let next = record;
  if (['installed', 'pending-restart', 'failed'].includes(next.state)) {
    next = transitionPackage(next, 'verifying', { event: 'activation-verify' });
  }
  next = transitionPackage(next, 'active', { event: 'activated' });
  return recordRuntimeEvent({
    ...next,
    activated: true,
    restart_required: false,
    health: null,
    binding,
  }, 'activation-committed');
}

export async function prepareInstalledPackage(type, id, options = {}) {
  const normalizedType = normalizePackageType(type);
  const normalizedId = normalizePackageId(id);
  const runtimeRegistry = options.runtimeRegistry || await readRuntimeRegistry(options.registryFile);
  const runtimeRecord = getRuntimePackage(runtimeRegistry, normalizedType, normalizedId, { includeRemoved: true });
  const key = packageKey(normalizedType, normalizedId);
  if (!runtimeRecord) throw new Error(`runtime package is not installed: ${key}`);
  if (runtimeRecord.state === 'removed') throw new Error(`runtime package is removed: ${key}`);
  if (runtimeRecord.enabled === false || runtimeRecord.state === 'disabled') throw new Error(`runtime package is disabled: ${key}`);

  const target = options.root
    ? packagePath(normalizedType, normalizedId, options.root)
    : runtimeRecord.path
      ? resolve(runtimeRecord.path)
      : packagePath(normalizedType, normalizedId);
  const lock = await readInstallLock(target);
  if (lock.type !== normalizedType) throw new Error(`install lock type mismatch: expected ${normalizedType}, got ${lock.type}`);
  if (lock.id !== normalizedId) throw new Error(`install lock id mismatch: expected ${normalizedId}, got ${lock.id}`);
  if (options.version && lock.version !== options.version) throw new Error(`installed version mismatch: expected ${options.version}, got ${lock.version}`);
  await verifyInstalledCommit(target, lock.source.commit, options);
  const compatibility = assertCompatibility(lock, options.environment);
  const compatibilityDecision = { compatible: compatibility?.compatible !== false && compatibility?.ok !== false };

  const policy = assertPolicyAllowed({
    operation: 'activate',
    package: { ...lock, type: normalizedType, id: normalizedId },
    publisher: lock.publisher,
    security: lock.security,
    verification: lock.supply_chain_verification,
    signer_revoked: lock.trust_snapshot?.signer_revoked === true,
    compatibility: compatibilityDecision,
    environment: options.environment || {},
    registry: options.registryIdentity || { name: lock.source?.registry || 'official', trusted: lock.source?.registry_trusted !== false },
    approved: true,
  });

  const adapter = getRuntimeAdapter(normalizedType);
  const prepared = await adapter.prepare({
    type: normalizedType,
    id: normalizedId,
    target,
    lock,
    record: runtimeRecord,
    options,
  });
  const binding = await adapter.bind(prepared);
  await adapter.activate({ ...prepared, binding, record: runtimeRecord, options });

  const hydrated = hydrateRuntimeRecord(runtimeRecord, lock, target);
  const activatedRecord = activateRuntimeRecord({
    ...hydrated,
    adapter: { type: adapter.type, abi_version: adapter.abi_version },
    policy_snapshot: compactPolicySnapshot(policy),
    activation: {
      ...(hydrated.activation || {}),
      attempts: Number(hydrated.activation?.attempts || 0) + 1,
      failure_fingerprint: null,
      last_attempt_at: new Date().toISOString(),
      last_success_at: new Date().toISOString(),
    },
  }, binding);

  return {
    key,
    id: lock.id,
    type: normalizedType,
    version: lock.version,
    channel: lock.channel,
    target,
    commit: lock.source.commit,
    runtime: lock.runtime || {},
    entrypoints: lock.entrypoints || {},
    capabilities: lock.capabilities || [],
    permissions: lock.permissions || [],
    compatibility,
    publisher: lock.publisher || null,
    security: lock.security || null,
    artifact: lock.artifact || null,
    content_digest: lock.content_digest || lock.content?.digest || null,
    trust_snapshot: lock.trust_snapshot || null,
    policy_snapshot: compactPolicySnapshot(policy),
    registry_revision: lock.registry_revision || null,
    resolution_hash: lock.resolution_hash || null,
    manifest_file: prepared.manifest.file,
    manifest: prepared.manifest.manifest,
    binding,
    adapter: { type: adapter.type, abi_version: adapter.abi_version },
    activation: 'active',
    activation_state: 'active',
    restart_required: activatedRecord.restart_required ?? false,
    activated_record: activatedRecord,
  };
}

async function loadInstalledPackageUnlocked(type, id, options = {}) {
  const prepared = await prepareInstalledPackage(type, id, options);
  await updateRuntimeRegistry((current) => upsertRuntimePackage(current, prepared.activated_record), options.registryFile);
  const result = { ...prepared };
  delete result.activated_record;
  return result;
}

export function loadInstalledPackage(type, id, options = {}) {
  const normalizedType = normalizePackageType(type);
  const normalizedId = normalizePackageId(id);
  return withPackageOperationLock(normalizedType, normalizedId, () => loadInstalledPackageUnlocked(normalizedType, normalizedId, options), options);
}
