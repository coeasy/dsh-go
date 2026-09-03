import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
  runtimeRoot,
  upsertRuntimePackage,
  writeRuntimeRegistry,
} from './registry.mjs';
import { readInstallLock } from './verifier.mjs';

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
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, target);
}

export async function createEnvironmentLock(options = {}) {
  const registry = await readRuntimeRegistry(options.registryFile);
  const packages = [];
  for (const record of (registry.packages || []).filter((item) => item.state !== 'removed')) {
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
      await rm(move.target, { recursive: true, force: true });
      if (move.had_previous && await pathExists(move.backup)) await rename(move.backup, move.target);
    } else if (move.kind === 'prune') {
      if (await pathExists(move.backup)) await rename(move.backup, move.target);
    }
  }
}

export async function restoreEnvironmentLock(options = {}) {
  const { file, lock } = await readEnvironmentLock(options.lockFile || environmentLockPath());
  const runtime = await readRuntimeRegistry(options.registryFile);
  const expected = new Set(lock.packages.map((item) => packageKey(item.type, item.id)));
  const extras = (runtime.packages || []).filter((item) => item.state !== 'removed' && !expected.has(packageKey(item.type, item.id)));
  const plan = {
    file,
    content_hash: lock.content_hash,
    restore: lock.packages.map((item) => ({ key: packageKey(item.type, item.id), version: item.version, digest: item.content.digest })),
    prune: extras.map((item) => ({ key: packageKey(item.type, item.id), version: item.version })),
    restart_required: lock.packages.length > 0 || extras.length > 0,
    auto_restart: false,
  };
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

  const transactionId = randomUUID();
  const root = join(environmentTransactionRoot(options), `environment-restore-${transactionId}`);
  const moves = [];
  let nextRegistry = runtime;
  await mkdir(root, { recursive: true });
  try {
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
      await mkdir(dirname(backup), { recursive: true });
      if (hadPrevious) await rename(target, backup);
      await mkdir(dirname(target), { recursive: true });
      await rename(stage, target);
      moves.push({ kind: 'replace', target, backup, had_previous: hadPrevious });
      nextRegistry = upsertRuntimePackage(nextRegistry, restoredRuntimeRecord(item, target, previous?.state === 'removed' ? null : previous, transactionId));
    }

    for (const extra of extras) {
      const target = extra.path || packagePath(extra.type, extra.id);
      const backup = join(root, 'pruned', extra.type, extra.id);
      if (await pathExists(target)) {
        await mkdir(dirname(backup), { recursive: true });
        await rename(target, backup);
        moves.push({ kind: 'prune', target, backup });
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

    const written = await writeRuntimeRegistry(nextRegistry, options.registryFile);
    await rm(root, { recursive: true, force: true });
    return {
      ...plan,
      executed: true,
      dry_run: false,
      transaction_id: transactionId,
      generation: written.generation,
      restored: lock.packages.length,
      pruned: extras.length,
    };
  } catch (error) {
    try { await rollbackMoves(moves); } catch (rollbackError) { error.rollback_error = rollbackError.message; }
    await rm(root, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
