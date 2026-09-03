import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { copyCasSnapshot, hashDirectory, snapshotDirectory, verifyCasSnapshot } from './cas-store.mjs';
import { recordRuntimeEvent } from './lifecycle.mjs';
import { packageKey } from './package-model.mjs';
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

export const ENVIRONMENT_LOCK_SCHEMA_VERSION = 1;

export function environmentLockPath() {
  return resolve(process.env.DSH_ENVIRONMENT_LOCK || join(homedir(), '.dsh', 'dsh.lock'));
}

function environmentTransactionRoot(options = {}) {
  if (options.transactionHome) return resolve(options.transactionHome);
  if (options.registryFile) return join(dirname(resolve(options.registryFile)), 'environment-transactions');
  return resolve(process.env.DSH_ENVIRONMENT_TRANSACTION_HOME || join(runtimeRoot(), 'environment-transactions'));
}

function canonicalLockPayload(lock) {
  return {
    schema_version: ENVIRONMENT_LOCK_SCHEMA_VERSION,
    runtime_registry_schema: Number(lock.runtime_registry_schema) || 3,
    packages: [...(lock.packages || [])]
      .map((item) => ({ ...item }))
      .sort((left, right) => packageKey(left.type, left.id).localeCompare(packageKey(right.type, right.id))),
  };
}

export function environmentLockContentHash(lock) {
  return createHash('sha256').update(JSON.stringify(canonicalLockPayload(lock))).digest('hex');
}

function lockRuntimeRecord(record, installLock, snapshot) {
  return {
    type: record.type || installLock.type || 'plugin',
    id: record.id || installLock.id,
    version: installLock.version,
    channel: installLock.channel || record.channel || 'stable',
    commit: installLock.source.commit,
    source: installLock.source,
    artifact: installLock.artifact || null,
    runtime: installLock.runtime || {},
    capabilities: installLock.capabilities || [],
    dependencies: installLock.dependencies || [],
    permissions: installLock.permissions || [],
    permission_policy: installLock.permission_policy || null,
    permission_manifest: installLock.permission_manifest || null,
    compatibility: installLock.compatibility || {},
    publisher: installLock.publisher || null,
    security: installLock.security || null,
    conflicts: installLock.conflicts || [],
    replaces: installLock.replaces || [],
    provides: installLock.provides || [],
    type_config: installLock.type_config || null,
    enabled: record.enabled !== false,
    previous_state: record.state || 'installed',
    installed_at: installLock.installed_at || record.installed_at || null,
    content: {
      algorithm: 'sha256',
      digest: snapshot.digest,
      entries: snapshot.entries,
    },
  };
}

async function writeAtomic(file, value) {
  const target = resolve(file);
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function createEnvironmentLock(options = {}) {
  const initialRegistry = await readRuntimeRegistry(options.registryFile);
  const operationPackages = (initialRegistry.packages || []).filter((item) => item.state !== 'removed');
  return withPackageOperationLocks(operationPackages, async () => {
    const registry = await readRuntimeRegistry(options.registryFile);
    if (registry.generation !== initialRegistry.generation) {
      const error = new Error(`runtime registry changed while creating environment lock: expected generation ${initialRegistry.generation}, current ${registry.generation}`);
      error.code = 'DSH_ENVIRONMENT_LOCK_CONFLICT';
      throw error;
    }
    const packages = [];
    for (const record of operationPackages) {
      if (!record.path || !await pathExists(record.path)) throw new Error(`cannot lock missing runtime package path: ${packageKey(record.type, record.id)}`);
      const installLock = await readInstallLock(record.path);
      if (installLock.type !== record.type || installLock.id !== record.id || installLock.version !== record.version) {
        throw new Error(`runtime/install lock identity mismatch: ${packageKey(record.type, record.id)}`);
      }
      const snapshot = await snapshotDirectory(record.path, { root: options.storeRoot });
      packages.push(lockRuntimeRecord(record, installLock, snapshot));
    }

    packages.sort((left, right) => packageKey(left.type, left.id).localeCompare(packageKey(right.type, right.id)));
    const lock = {
      schema_version: ENVIRONMENT_LOCK_SCHEMA_VERSION,
      runtime_registry_schema: registry.schema_version || 3,
      created_at: new Date().toISOString(),
      packages,
    };
    lock.content_hash = environmentLockContentHash(lock);
    const file = resolve(options.lockFile || environmentLockPath());
    await writeAtomic(file, lock);
    return {
      file,
      content_hash: lock.content_hash,
      packages: lock.packages.length,
      store_root: resolve(options.storeRoot || process.env.DSH_STORE_HOME || join(homedir(), '.dsh', 'store', 'sha256')),
      lock,
    };
  }, options);
}

export async function readEnvironmentLock(file = environmentLockPath()) {
  const target = resolve(file);
  const lock = JSON.parse(await readFile(target, 'utf8'));
  if (lock?.schema_version !== ENVIRONMENT_LOCK_SCHEMA_VERSION || !Array.isArray(lock?.packages)) {
    throw new Error(`unsupported or invalid environment lock: ${target}`);
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
    && String(installLock.source?.commit || '').toLowerCase() === String(item.commit || '').toLowerCase();
}

export async function verifyEnvironmentLock(options = {}) {
  const { file, lock } = await readEnvironmentLock(options.lockFile || environmentLockPath());
  const runtime = await readRuntimeRegistry(options.registryFile);
  const results = [];
  for (const item of lock.packages) {
    const key = packageKey(item.type, item.id);
    const cas = await verifyCasSnapshot(item.content.digest, { root: options.storeRoot });
    const runtimeRecord = getRuntimePackage(runtime, item.type, item.id, { includeRemoved: true });
    const target = runtimeRecord?.path || packagePath(item.type, item.id);
    let installed = { exists: false, identity_ok: false, digest_ok: false, digest: null };
    if (await pathExists(target)) {
      try {
        const installLock = await readInstallLock(target);
        const actual = await hashDirectory(target);
        installed = {
          exists: true,
          identity_ok: sameInstallIdentity(item, installLock),
          digest_ok: actual.digest === item.content.digest,
          digest: actual.digest,
        };
      } catch (error) {
        installed = { exists: true, identity_ok: false, digest_ok: false, digest: null, error: error.message };
      }
    }
    results.push({
      key,
      type: item.type,
      id: item.id,
      version: item.version,
      commit: item.commit,
      cas_ok: cas.ok,
      cas_path: cas.path,
      installed_path: target,
      installed,
      ok: cas.ok && installed.exists && installed.identity_ok && installed.digest_ok,
    });
  }
  const expected = new Set(lock.packages.map((item) => packageKey(item.type, item.id)));
  const extras = (runtime.packages || [])
    .filter((item) => item.state !== 'removed' && !expected.has(packageKey(item.type, item.id)))
    .map((item) => ({ key: packageKey(item.type, item.id), version: item.version, state: item.state }));
  return {
    file,
    content_hash: lock.content_hash,
    packages: results,
    extras,
    ok: results.every((item) => item.ok) && extras.length === 0,
  };
}

function restoredRuntimeRecord(item, target, previous, transactionId) {
  const base = previous || {};
  return recordRuntimeEvent({
    ...base,
    id: item.id,
    type: item.type,
    version: item.version,
    channel: item.channel || 'stable',
    state: 'pending-restart',
    path: target,
    source: item.source,
    commit: item.commit,
    runtime: item.runtime || {},
    capabilities: item.capabilities || [],
    dependencies: item.dependencies || [],
    permissions: item.permissions || [],
    permission_policy: item.permission_policy || null,
    permission_manifest: item.permission_manifest || null,
    compatibility: item.compatibility || {},
    publisher: item.publisher || null,
    security: item.security || null,
    conflicts: item.conflicts || [],
    replaces: item.replaces || [],
    provides: item.provides || [],
    type_config: item.type_config || null,
    enabled: item.enabled !== false,
    activated: false,
    binding: null,
    restart_required: true,
    health: null,
    restored_from_lock: true,
  }, 'environment-restored', { transaction_id: transactionId, content_digest: item.content.digest });
}

async function rollbackMoves(moves) {
  for (const move of [...moves].reverse()) {
    if (move.kind === 'replace') {
      if (move.target_moved) await rm(move.target, { recursive: true, force: true });
      if (move.had_previous && move.backup_moved && await pathExists(move.backup)) await rename(move.backup, move.target);
    } else if (move.kind === 'prune') {
      if (move.backup_moved && await pathExists(move.backup)) await rename(move.backup, move.target);
    }
  }
}

function environmentIdentity(value) {
  if (!value) return null;
  return {
    type: value.type || value.package_type || 'plugin',
    id: value.id,
    version: value.version,
    commit: value.commit || value.source?.commit || null,
  };
}

function sameEnvironmentIdentity(left, right) {
  return Boolean(left && right)
    && left.type === right.type
    && left.id === right.id
    && left.version === right.version
    && String(left.commit || '').toLowerCase() === String(right.commit || '').toLowerCase();
}

async function inspectEnvironmentPath(path) {
  if (!await pathExists(path)) return { exists: false, identity: null };
  try {
    return { exists: true, identity: environmentIdentity(await readInstallLock(path)) };
  } catch (error) {
    return { exists: true, identity: null, error };
  }
}

function environmentRecoveryConflict(message) {
  const error = new Error(message);
  error.code = 'DSH_ENVIRONMENT_RECOVERY_CONFLICT';
  return error;
}

async function recoverEnvironmentMoves(moves) {
  const inspected = [];
  for (const move of [...(moves || [])].reverse()) {
    const target = await inspectEnvironmentPath(move.target);
    const backup = await inspectEnvironmentPath(move.backup);
    if (move.kind === 'replace') {
      const expected = move.expected;
      const previous = move.previous;
      if (target.error || backup.error) throw environmentRecoveryConflict(`environment recovery found an unreadable package path for ${move.type}:${move.id}`);
      if (move.had_previous) {
        if (backup.exists) {
          if (!sameEnvironmentIdentity(backup.identity, previous)) throw environmentRecoveryConflict(`environment recovery backup identity mismatch for ${move.type}:${move.id}`);
          if (target.exists && !sameEnvironmentIdentity(target.identity, expected)) {
            throw environmentRecoveryConflict(`environment recovery target identity mismatch for ${move.type}:${move.id}`);
          }
          inspected.push({ move, action: 'restore', removeTarget: target.exists });
        } else if (!target.exists) {
          throw environmentRecoveryConflict(`environment recovery lost original package for ${move.type}:${move.id}`);
        } else if (sameEnvironmentIdentity(target.identity, previous)) {
          inspected.push({ move, action: 'none' });
        } else {
          throw environmentRecoveryConflict(`environment recovery cannot identify original package for ${move.type}:${move.id}`);
        }
      } else if (!target.exists) {
        inspected.push({ move, action: 'none' });
      } else if (sameEnvironmentIdentity(target.identity, expected)) {
        inspected.push({ move, action: 'remove' });
      } else {
        throw environmentRecoveryConflict(`environment recovery found unexpected new package for ${move.type}:${move.id}`);
      }
    } else if (move.kind === 'prune') {
      if (target.error || backup.error) throw environmentRecoveryConflict(`environment recovery found an unreadable pruned path for ${move.type}:${move.id}`);
      if (backup.exists) {
        if (!sameEnvironmentIdentity(backup.identity, move.expected)) throw environmentRecoveryConflict(`environment recovery pruned backup identity mismatch for ${move.type}:${move.id}`);
        if (target.exists) throw environmentRecoveryConflict(`environment recovery found duplicate pruned package for ${move.type}:${move.id}`);
        inspected.push({ move, action: 'restore' });
      } else if (target.exists && sameEnvironmentIdentity(target.identity, move.expected)) {
        inspected.push({ move, action: 'none' });
      } else {
        throw environmentRecoveryConflict(`environment recovery lost pruned package for ${move.type}:${move.id}`);
      }
    } else {
      throw environmentRecoveryConflict(`environment recovery encountered an unknown move kind: ${move.kind}`);
    }
  }

  for (const item of inspected) {
    const { move } = item;
    if (item.action === 'none') continue;
    if (item.action === 'remove') {
      await rm(move.target, { recursive: true, force: true });
      continue;
    }
    if (item.removeTarget) await rm(move.target, { recursive: true, force: true });
    await mkdir(dirname(move.target), { recursive: true });
    await rename(move.backup, move.target);
  }
}

function environmentTransactionRecorded(registry, journal) {
  const restored = journal.packages || [];
  const pruned = journal.pruned || [];
  const expected = [...restored, ...pruned];
  if (!journal.id || !expected.length) return false;
  return expected.every((candidate) => {
    const record = getRuntimePackage(registry, candidate.type, candidate.id, { includeRemoved: true });
    const event = pruned.some((item) => packageKey(item.type, item.id) === packageKey(candidate.type, candidate.id))
      ? 'environment-pruned'
      : 'environment-restored';
    return Boolean(record && (record.history || []).some((entry) => entry.transaction_id === journal.id && entry.event === event));
  });
}

export async function recoverEnvironmentTransactions(options = {}) {
  const base = environmentTransactionRoot(options);
  const defaultRegistryFile = resolve(registryPath());
  const requestedRegistryFile = resolve(options.registryFile || defaultRegistryFile);
  const registryWasExplicit = Boolean(options.registryFile);
  let entries;
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return { recovered: [] };
    throw error;
  }

  const recovered = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const root = join(base, entry.name);
    try {
      let journal;
      try {
        journal = JSON.parse(await readFile(join(root, 'journal.json'), 'utf8'));
      } catch (error) {
        if (error?.code === 'ENOENT') {
          const children = await readdir(root).catch(() => null);
          if (Array.isArray(children) && children.length === 0) await rm(root, { recursive: true, force: true }).catch(() => {});
          continue;
        }
        throw error;
      }
      const journalRegistryFile = journal.registry_file ? resolve(journal.registry_file) : null;
      if (journalRegistryFile && journalRegistryFile !== requestedRegistryFile) continue;
      if (!journalRegistryFile && registryWasExplicit && requestedRegistryFile !== defaultRegistryFile) continue;
      if (journal.state === 'committed') {
        await rm(root, { recursive: true, force: true });
        recovered.push({ id: journal.id || entry.name, state: 'committed-cleanup' });
        continue;
      }

      const registryFile = journalRegistryFile || requestedRegistryFile;
      const currentRegistry = await readRuntimeRegistry(registryFile);
      if (environmentTransactionRecorded(currentRegistry, journal)) {
        await rm(root, { recursive: true, force: true });
        recovered.push({ id: journal.id || entry.name, state: 'committed-detected', generation: currentRegistry.generation });
        continue;
      }
      const expectedGeneration = Number(journal.expected_generation);
      if (!Number.isFinite(expectedGeneration) || currentRegistry.generation !== expectedGeneration) {
        throw environmentRecoveryConflict(`runtime registry advanced after environment restore crash: expected generation ${expectedGeneration}, current ${currentRegistry.generation}`);
      }

      const operationPackages = journal.operation_packages || journal.packages || [];
      await withPackageOperationLocks(operationPackages, () => recoverEnvironmentMoves(journal.moves || []), { registryFile });
      await rm(root, { recursive: true, force: true });
      recovered.push({ id: journal.id || entry.name, state: 'rolled-back', interrupted_state: journal.state || 'unknown', generation: currentRegistry.generation });
    } catch (error) {
      recovered.push({ id: entry.name, state: 'conflict', error: error.message, code: error.code || null });
    }
  }
  return { recovered };
}

export async function restoreEnvironmentLock(options = {}) {
  const { file, lock } = await readEnvironmentLock(options.lockFile || environmentLockPath());
  const registryFile = resolve(options.registryFile || registryPath());
  const runtime = await readRuntimeRegistry(registryFile);
  const expected = new Set(lock.packages.map((item) => packageKey(item.type, item.id)));
  const extras = (runtime.packages || []).filter((item) => item.state !== 'removed' && !expected.has(packageKey(item.type, item.id)));
  const planFor = (current) => {
    const currentExtras = (current.packages || []).filter((item) => item.state !== 'removed' && !expected.has(packageKey(item.type, item.id)));
    return {
      file,
      content_hash: lock.content_hash,
      restore: lock.packages.map((item) => ({ key: packageKey(item.type, item.id), version: item.version, digest: item.content.digest })),
      prune: currentExtras.map((item) => ({ key: packageKey(item.type, item.id), version: item.version })),
      restart_required: lock.packages.length > 0 || currentExtras.length > 0,
      auto_restart: false,
    };
  };
  const plan = planFor(runtime);
  if (options.dryRun) return { ...plan, dry_run: true, executed: false };
  if (options.approved !== true) {
    const error = new Error('environment restore requires explicit --yes approval');
    error.code = 'DSH_RESTORE_APPROVAL_REQUIRED';
    error.plan = plan;
    throw error;
  }

  for (const item of lock.packages) {
    const cas = await verifyCasSnapshot(item.content.digest, { root: options.storeRoot });
    if (!cas.ok) throw new Error(`cannot restore corrupt or missing CAS snapshot: ${packageKey(item.type, item.id)}@${item.content.digest}`);
  }

  return withPackageOperationLocks([...lock.packages, ...extras], async () => {
    const latestRuntime = await readRuntimeRegistry(registryFile);
    const latestExtras = (latestRuntime.packages || []).filter((item) => item.state !== 'removed' && !expected.has(packageKey(item.type, item.id)));
    const initialExtraKeys = new Set(extras.map((item) => packageKey(item.type, item.id)));
    if (latestExtras.some((item) => !initialExtraKeys.has(packageKey(item.type, item.id)))) {
      const error = new Error('runtime registry changed with a new package while environment restore was preparing');
      error.code = 'DSH_ENVIRONMENT_RESTORE_CONFLICT';
      throw error;
    }
    const activePlan = planFor(latestRuntime);
    const transactionId = randomUUID();
    const root = join(environmentTransactionRoot({ ...options, registryFile }), `environment-restore-${transactionId}`);
    const moves = [];
    const journal = {
      schema_version: ENVIRONMENT_LOCK_SCHEMA_VERSION,
      kind: 'environment-restore',
      id: transactionId,
      state: 'staging',
      registry_file: registryFile,
      expected_generation: latestRuntime.generation,
      lock_file: file,
      lock_content_hash: lock.content_hash,
      packages: lock.packages.map(environmentIdentity),
      pruned: [],
      operation_packages: [...lock.packages, ...latestExtras].map(environmentIdentity),
      moves,
    };
    const writeRestoreJournal = (state, extra = {}) => writeAtomic(join(root, 'journal.json'), { ...journal, state, ...extra, moves });
    let nextRegistry = latestRuntime;
    let registryCommitted = false;
    await mkdir(root, { recursive: true });
    try {
    await writeRestoreJournal('staging');
    const staged = [];
    for (const item of lock.packages) {
      const stage = join(root, 'stage', item.type, item.id);
      await copyCasSnapshot(item.content.digest, stage, { root: options.storeRoot });
      const installLock = await readInstallLock(stage);
      if (!sameInstallIdentity(item, installLock)) throw new Error(`CAS install identity mismatch: ${packageKey(item.type, item.id)}`);
      staged.push({ item, stage });
    }

    for (const { item, stage } of staged) {
      const previous = getRuntimePackage(nextRegistry, item.type, item.id, { includeRemoved: true });
      const target = previous?.path || packagePath(item.type, item.id);
      const backup = join(root, 'backup', item.type, item.id);
      const hadPrevious = await pathExists(target);
      const move = {
        kind: 'replace',
        type: item.type,
        id: item.id,
        target,
        backup,
        expected: environmentIdentity(item),
        previous: environmentIdentity(previous),
        had_previous: hadPrevious,
        backup_moved: false,
        target_moved: false,
      };
      moves.push(move);
      await writeRestoreJournal('committing');
      await mkdir(dirname(backup), { recursive: true });
      if (hadPrevious) {
        await rename(target, backup);
        move.backup_moved = true;
        await writeRestoreJournal('committing');
      }
      await mkdir(dirname(target), { recursive: true });
      await rename(stage, target);
      move.target_moved = true;
      await writeRestoreJournal('committing');
      nextRegistry = upsertRuntimePackage(nextRegistry, restoredRuntimeRecord(item, target, previous?.state === 'removed' ? null : previous, transactionId));
    }

    for (const extra of latestExtras) {
      const target = extra.path || packagePath(extra.type, extra.id);
      const backup = join(root, 'pruned', extra.type, extra.id);
      const move = { kind: 'prune', type: extra.type, id: extra.id, target, backup, expected: environmentIdentity(extra), backup_moved: false };
      moves.push(move);
      journal.pruned.push(environmentIdentity(extra));
      await writeRestoreJournal('committing');
      if (await pathExists(target)) {
        await mkdir(dirname(backup), { recursive: true });
        await rename(target, backup);
        move.backup_moved = true;
        await writeRestoreJournal('committing');
      }
      nextRegistry = upsertRuntimePackage(nextRegistry, recordRuntimeEvent({
        ...extra,
        state: 'removed',
        enabled: false,
        activated: false,
        binding: null,
        restart_required: true,
        health: null,
      }, 'environment-pruned', { transaction_id: transactionId }));
    }

    await writeRestoreJournal('committing');
    const written = await writeRuntimeRegistry(nextRegistry, registryFile);
    registryCommitted = true;
    // Do not roll back the filesystem after the Registry commit. Cleanup is
    // deliberately best effort; the committed state is authoritative.
    await writeRestoreJournal('committed', { generation: written.generation }).catch(() => {});
    await rm(root, { recursive: true, force: true }).catch(() => {});
    return {
      ...activePlan,
      executed: true,
      dry_run: false,
      transaction_id: transactionId,
      generation: written.generation,
      restored: lock.packages.length,
      pruned: latestExtras.length,
    };
  } catch (error) {
    if (!registryCommitted) {
      let rolledBack = false;
      try {
        await rollbackMoves(moves);
        rolledBack = true;
      } catch (rollbackError) {
        error.rollback_error = rollbackError.message;
        await writeRestoreJournal('recovery-required', { error: error.message, rollback_error: rollbackError.message }).catch(() => {});
      }
      if (rolledBack) await rm(root, { recursive: true, force: true }).catch(() => {});
    } else {
      error.state_preserved = true;
      await writeRestoreJournal('committed').catch(() => {});
      await rm(root, { recursive: true, force: true }).catch(() => {});
    }
      throw error;
    }
  }, options);
}
