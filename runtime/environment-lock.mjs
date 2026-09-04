import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { copyCasSnapshot, hashDirectory, snapshotDirectory, verifyCasSnapshot } from './cas-store.mjs';
import { recordRuntimeEvent } from './lifecycle.mjs';
import { packageKey } from '../packages/protocol-core/index.mjs';
import { assertPolicyAllowed, compactPolicySnapshot } from '../packages/policy-core/index.mjs';
import {
  getRuntimePackage,
  packagePath,
  pathExists,
  readRuntimeRegistry,
  registryPath,
  runtimeRoot,
  upsertRuntimePackage,
  writeRuntimeRegistry,
} from './registry.mjs';
import { readInstallLock } from './verifier.mjs';
import { withPackageOperationLocks } from './package-operation-lock.mjs';
import { readTrustRoot } from './trust-store.mjs';

export const ENVIRONMENT_LOCK_SCHEMA_VERSION = 2;

export function environmentLockPath() {
  return resolve(process.env.DSH_ENVIRONMENT_LOCK || join(homedir(), '.dsh', 'dsh.lock'));
}

function environmentTransactionRoot(options = {}) {
  if (options.transactionHome) return resolve(options.transactionHome);
  if (options.registryFile) return join(dirname(resolve(options.registryFile)), 'environment-transactions-v2');
  return resolve(process.env.DSH_ENVIRONMENT_TRANSACTION_HOME || join(runtimeRoot(), 'environment-transactions-v2'));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function canonicalLockPayload(lock) {
  return {
    schema_version: ENVIRONMENT_LOCK_SCHEMA_VERSION,
    protocol_version: 2,
    runtime_state_schema: 4,
    packages: [...(lock.packages || [])].map((item) => ({ ...item })).sort((a, b) => packageKey(a.type, a.id).localeCompare(packageKey(b.type, b.id))),
  };
}

export function environmentLockContentHash(lock) {
  return createHash('sha256').update(JSON.stringify(stable(canonicalLockPayload(lock)))).digest('hex');
}

async function writeAtomic(file, value) {
  const target = resolve(file);
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

function lockedPackage(record, installLock, snapshot) {
  return {
    type: record.type,
    id: record.id,
    version: installLock.version,
    channel: installLock.channel || record.channel || 'stable',
    commit: installLock.source.commit,
    source: installLock.source,
    registry_revision: installLock.registry_revision || record.registry_revision || null,
    resolution_hash: installLock.resolution_hash || record.resolution_hash || null,
    artifact: installLock.artifact || null,
    installation: installLock.installation || null,
    runtime: installLock.runtime || {},
    entrypoints: installLock.entrypoints || {},
    capabilities: installLock.capabilities || [],
    dependencies: installLock.dependencies || [],
    permissions: installLock.permissions || [],
    compatibility: installLock.compatibility || {},
    publisher: installLock.publisher || null,
    security: installLock.security || null,
    supply_chain_verification: installLock.supply_chain_verification || record.supply_chain_verification || null,
    trust_snapshot: installLock.trust_snapshot || record.trust_snapshot || null,
    policy_snapshot: installLock.policy_snapshot || record.policy_snapshot || null,
    adapter: installLock.adapter || record.adapter || null,
    enabled: record.enabled !== false,
    content: { algorithm: 'sha256', digest: snapshot.digest, entries: snapshot.entries },
    content_digest: snapshot.digest,
  };
}

function installLockFromEnvironment(item) {
  return {
    schema_version: 4,
    runtime_state_version: 4,
    protocol_version: 2,
    id: item.id,
    type: item.type,
    version: item.version,
    channel: item.channel || 'stable',
    source: item.source,
    registry_revision: item.registry_revision || null,
    resolution_hash: item.resolution_hash || null,
    artifact: item.artifact || {},
    installation: item.installation || { source: 'environment-cas', verified_at: new Date().toISOString() },
    content: item.content,
    content_digest: item.content.digest,
    runtime: item.runtime || {},
    entrypoints: item.entrypoints || {},
    capabilities: item.capabilities || [],
    dependencies: item.dependencies || [],
    permissions: item.permissions || [],
    compatibility: item.compatibility || {},
    publisher: item.publisher || null,
    security: item.security || null,
    supply_chain_verification: item.supply_chain_verification || null,
    trust_snapshot: item.trust_snapshot || null,
    policy_snapshot: item.policy_snapshot || null,
    adapter: item.adapter || null,
    installed_at: new Date().toISOString(),
    restart_required: true,
  };
}

export async function createEnvironmentLock(options = {}) {
  const initial = await readRuntimeRegistry(options.registryFile);
  const active = initial.packages.filter((item) => item.state !== 'removed');
  return withPackageOperationLocks(active, async () => {
    const current = await readRuntimeRegistry(options.registryFile);
    if (current.generation !== initial.generation) {
      const error = new Error(`runtime state changed while creating environment lock: expected ${initial.generation}, current ${current.generation}`);
      error.code = 'DSH_ENVIRONMENT_LOCK_CONFLICT';
      throw error;
    }
    const packages = [];
    for (const record of active) {
      const target = record.path || packagePath(record.type, record.id);
      if (!await pathExists(target)) throw new Error(`cannot lock missing package path: ${packageKey(record.type, record.id)}`);
      const installLock = await readInstallLock(target);
      if (installLock.type !== record.type || installLock.id !== record.id || installLock.version !== record.version) throw new Error(`runtime/install-lock identity mismatch: ${packageKey(record.type, record.id)}`);
      const snapshot = await snapshotDirectory(target, { root: options.storeRoot });
      packages.push(lockedPackage(record, installLock, snapshot));
    }
    packages.sort((a, b) => packageKey(a.type, a.id).localeCompare(packageKey(b.type, b.id)));
    const lock = {
      schema_version: ENVIRONMENT_LOCK_SCHEMA_VERSION,
      protocol_version: 2,
      runtime_state_schema: 4,
      created_at: new Date().toISOString(),
      source_generation: current.generation,
      packages,
    };
    lock.content_hash = environmentLockContentHash(lock);
    const file = resolve(options.lockFile || environmentLockPath());
    await writeAtomic(file, lock);
    return { file, content_hash: lock.content_hash, packages: packages.length, lock };
  }, options);
}

export async function readEnvironmentLock(file = environmentLockPath()) {
  const target = resolve(file);
  const lock = JSON.parse(await readFile(target, 'utf8'));
  if (lock?.schema_version !== 2 || lock?.protocol_version !== 2 || lock?.runtime_state_schema !== 4 || !Array.isArray(lock?.packages)) {
    const error = new Error(`unsupported environment lock; create a new V2 lock: ${target}`);
    error.code = 'DSH_STATE_SCHEMA_UNSUPPORTED';
    throw error;
  }
  const expected = environmentLockContentHash(lock);
  if (lock.content_hash !== expected) {
    const error = new Error(`environment lock content hash mismatch: expected ${lock.content_hash}, calculated ${expected}`);
    error.code = 'DSH_ENVIRONMENT_LOCK_TAMPERED';
    throw error;
  }
  const seen = new Set();
  for (const item of lock.packages) {
    if (!item?.type || !item?.id || !item?.version || !item?.commit || !item?.content?.digest) throw new Error('environment lock contains incomplete package identity');
    const key = packageKey(item.type, item.id);
    if (seen.has(key)) throw new Error(`environment lock contains duplicate package: ${key}`);
    seen.add(key);
  }
  return { file: target, lock };
}

function sameInstallIdentity(item, installLock) {
  return installLock.type === item.type
    && installLock.id === item.id
    && installLock.version === item.version
    && String(installLock.source?.commit || '').toLowerCase() === String(item.commit || '').toLowerCase()
    && (installLock.content_digest || installLock.content?.digest) === item.content.digest;
}

export async function verifyEnvironmentLock(options = {}) {
  const { file, lock } = await readEnvironmentLock(options.lockFile || environmentLockPath());
  const runtime = await readRuntimeRegistry(options.registryFile);
  const results = [];
  for (const item of lock.packages) {
    const cas = await verifyCasSnapshot(item.content.digest, { root: options.storeRoot });
    const record = getRuntimePackage(runtime, item.type, item.id, { includeRemoved: true });
    const target = record?.path || packagePath(item.type, item.id);
    let installed = { exists: false, identity_ok: false, digest_ok: false, digest: null };
    if (await pathExists(target)) {
      try {
        const installLock = await readInstallLock(target);
        const actual = await hashDirectory(target);
        installed = { exists: true, identity_ok: sameInstallIdentity(item, installLock), digest_ok: actual.digest === item.content.digest, digest: actual.digest };
      } catch (error) { installed = { exists: true, identity_ok: false, digest_ok: false, digest: null, error: error.message }; }
    }
    results.push({ key: packageKey(item.type, item.id), cas_ok: cas.ok, installed_path: target, installed, ok: cas.ok && installed.exists && installed.identity_ok && installed.digest_ok });
  }
  const expected = new Set(lock.packages.map((item) => packageKey(item.type, item.id)));
  const extras = runtime.packages.filter((item) => item.state !== 'removed' && !expected.has(packageKey(item.type, item.id))).map((item) => ({ key: packageKey(item.type, item.id), version: item.version, state: item.state }));
  return { file, content_hash: lock.content_hash, packages: results, extras, ok: results.every((item) => item.ok) && extras.length === 0 };
}

function restoredRecord(item, target, previous, transactionId, policySnapshot) {
  return recordRuntimeEvent({
    ...(previous || {}),
    id: item.id,
    type: item.type,
    version: item.version,
    channel: item.channel || 'stable',
    state: 'pending-restart',
    path: target,
    source: item.source,
    commit: item.commit,
    runtime: item.runtime || {},
    entrypoints: item.entrypoints || {},
    capabilities: item.capabilities || [],
    dependencies: item.dependencies || [],
    permissions: item.permissions || [],
    compatibility: item.compatibility || {},
    publisher: item.publisher || null,
    security: item.security || null,
    artifact: item.artifact || null,
    supply_chain_verification: item.supply_chain_verification || null,
    trust_snapshot: item.trust_snapshot || null,
    policy_snapshot: policySnapshot || item.policy_snapshot || null,
    adapter: item.adapter || null,
    content: item.content,
    content_digest: item.content.digest,
    registry_revision: item.registry_revision || null,
    resolution_hash: item.resolution_hash || null,
    enabled: item.enabled !== false,
    activated: false,
    binding: null,
    restart_required: true,
    health: null,
    activation: { attempts: 0, failed_attempts: 0, failure_fingerprint: null, restored_transaction_id: transactionId },
  }, 'environment-restored', { transaction_id: transactionId, content_digest: item.content.digest });
}

async function rollbackMoves(moves) {
  for (const move of [...moves].reverse()) {
    await rm(move.target, { recursive: true, force: true }).catch(() => {});
    if (move.backup && await pathExists(move.backup)) await rename(move.backup, move.target);
  }
}

function environmentTransactionRecorded(state, journal) {
  return (journal.package_keys || []).every((key) => {
    const [type, ...idParts] = key.split(':');
    const record = getRuntimePackage(state, type, idParts.join(':'), { includeRemoved: true });
    return record && (record.history || []).some((event) => event.event === 'environment-restored' && event.transaction_id === journal.id);
  });
}

function signerRevoked(item, trustRoot) {
  const signer = item.trust_snapshot?.signer_identity;
  return Boolean(signer && trustRoot.revoked_signers?.includes(signer));
}

function policyForRestore(item, trustRoot, options) {
  return assertPolicyAllowed({
    operation: 'restore',
    package: item,
    publisher: item.publisher,
    permissions: item.permissions,
    security: item.security,
    verification: item.supply_chain_verification || {},
    publisher_verified: item.trust_snapshot?.publisher_verified === true,
    signer_identity: item.trust_snapshot?.signer_identity,
    signer_revoked: signerRevoked(item, trustRoot),
    compatibility: { compatible: true },
    environment: options.environment || {},
    registry: {
      name: item.source?.registry || 'official',
      url: item.source?.registry_url || null,
      trusted: item.source?.registry_trusted !== false,
      organization: item.source?.registry_organization || null,
    },
    approved: true,
  });
}

export async function restoreEnvironmentLock(options = {}) {
  if (options.approved !== true && options.dryRun !== true) {
    const error = new Error('environment restore requires explicit approval');
    error.code = 'DSH_PERMISSION_DENIED';
    throw error;
  }
  const { file, lock } = await readEnvironmentLock(options.lockFile || environmentLockPath());
  const initial = await readRuntimeRegistry(options.registryFile);
  const trustRoot = options.trustRoot || await readTrustRoot(options.trustRootFile);
  const checks = [];
  for (const item of lock.packages) {
    const cas = await verifyCasSnapshot(item.content.digest, { root: options.storeRoot });
    if (!cas.ok) throw new Error(`CAS snapshot is invalid for ${packageKey(item.type, item.id)}`);
    const policy = policyForRestore(item, trustRoot, options);
    checks.push({ key: packageKey(item.type, item.id), content_digest: item.content.digest, policy: compactPolicySnapshot(policy) });
  }
  if (options.dryRun === true) {
    return { file, content_hash: lock.content_hash, packages: lock.packages.length, checks, changed: false, dry_run: true, restart_required: true, auto_restart: false };
  }

  const operation = [...lock.packages];
  return withPackageOperationLocks(operation, async () => {
    const current = await readRuntimeRegistry(options.registryFile);
    if (current.generation !== initial.generation) {
      const error = new Error(`runtime state changed before environment restore: expected ${initial.generation}, current ${current.generation}`);
      error.code = 'DSH_ENVIRONMENT_LOCK_CONFLICT';
      throw error;
    }
    const transactionId = randomUUID();
    const transaction = join(environmentTransactionRoot(options), transactionId);
    const moves = [];
    const journal = { schema_version: 2, id: transactionId, state: 'preparing', registry_file: resolve(options.registryFile || registryPath()), expected_generation: current.generation, package_keys: lock.packages.map((item) => packageKey(item.type, item.id)), moves };
    await writeAtomic(join(transaction, 'journal.json'), journal);
    let next = current;
    try {
      for (const item of lock.packages) {
        const existing = getRuntimePackage(current, item.type, item.id, { includeRemoved: true });
        const target = existing?.path || packagePath(item.type, item.id);
        const temp = `${target}.env-${transactionId}`;
        const backup = `${target}.env-backup-${transactionId}`;
        await rm(temp, { recursive: true, force: true });
        await copyCasSnapshot(item.content.digest, temp, { root: options.storeRoot });
        const installLock = installLockFromEnvironment(item);
        await writeFile(join(temp, '.dsh-install.json'), `${JSON.stringify(installLock, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
        const verifiedLock = await readInstallLock(temp);
        if (!sameInstallIdentity(item, verifiedLock)) throw new Error(`environment snapshot identity mismatch: ${packageKey(item.type, item.id)}`);
        let hadPrevious = false;
        if (await pathExists(target)) { await rename(target, backup); hadPrevious = true; }
        await mkdir(dirname(target), { recursive: true });
        await rename(temp, target);
        moves.push({ key: packageKey(item.type, item.id), target, backup: hadPrevious ? backup : null });
        journal.state = 'restoring'; journal.moves = moves; await writeAtomic(join(transaction, 'journal.json'), journal);
        const check = checks.find((entry) => entry.key === packageKey(item.type, item.id));
        next = upsertRuntimePackage(next, restoredRecord(item, target, existing, transactionId, check?.policy));
      }
      if (options.prune === true) {
        const expected = new Set(lock.packages.map((item) => packageKey(item.type, item.id)));
        for (const extra of current.packages.filter((item) => item.state !== 'removed' && !expected.has(packageKey(item.type, item.id)))) {
          const target = extra.path || packagePath(extra.type, extra.id);
          const backup = `${target}.env-backup-${transactionId}`;
          if (await pathExists(target)) { await rename(target, backup); moves.push({ key: packageKey(extra.type, extra.id), target, backup }); }
          next = upsertRuntimePackage(next, recordRuntimeEvent({ ...extra, state: 'removed', enabled: false, activated: false, restart_required: true, binding: null }, 'environment-pruned', { transaction_id: transactionId }));
        }
      }
      journal.state = 'committing'; journal.moves = moves; await writeAtomic(join(transaction, 'journal.json'), journal);
      const committed = await writeRuntimeRegistry({ ...next, activation: { ...(next.activation || {}), candidate_generation: current.generation } }, options.registryFile);
      for (const move of moves) if (move.backup) await rm(move.backup, { recursive: true, force: true }).catch(() => {});
      await rm(transaction, { recursive: true, force: true });
      return { file, content_hash: lock.content_hash, packages: lock.packages.length, generation: committed.generation, transaction_id: transactionId, checks, changed: true, restart_required: true, auto_restart: false };
    } catch (error) {
      await rollbackMoves(moves).catch((rollbackError) => { error.rollback_error = rollbackError.message; error.recovery_required = true; });
      if (!error.recovery_required) await rm(transaction, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }, options);
}

export async function recoverEnvironmentTransactions(options = {}) {
  const root = environmentTransactionRoot(options);
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error?.code === 'ENOENT') return { recovered: [] }; throw error; }
  const recovered = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    try {
      const journal = JSON.parse(await readFile(join(dir, 'journal.json'), 'utf8'));
      if (journal.schema_version !== 2) throw new Error('unsupported environment transaction journal');
      const state = await readRuntimeRegistry(journal.registry_file || options.registryFile);
      if (environmentTransactionRecorded(state, journal)) {
        await rm(dir, { recursive: true, force: true });
        recovered.push({ id: journal.id, state: 'committed-detected' });
        continue;
      }
      if (state.generation !== journal.expected_generation) throw new Error(`runtime state advanced: expected ${journal.expected_generation}, current ${state.generation}`);
      await rollbackMoves(journal.moves || []);
      await rm(dir, { recursive: true, force: true });
      recovered.push({ id: journal.id, state: 'rolled-back' });
    } catch (error) { recovered.push({ id: entry.name, state: 'conflict', error: error.message }); }
  }
  return { recovered };
}
