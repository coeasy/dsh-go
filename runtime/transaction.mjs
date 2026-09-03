import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { installPackage } from './installer.mjs';
import { createRuntimePackageRecord, recordRuntimeEvent } from './lifecycle.mjs';
import { inspectPermissions } from './permissions.mjs';
import { buildDependencyPlan, loadRegistryFile, resolvePackage } from './resolver.mjs';
import { assertPackageType, packageKey, parsePackageSpec, safePackageId } from './package-model.mjs';
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
import { preflightPackage } from './preflight.mjs';
import { readInstallLock } from './verifier.mjs';
import { withPackageOperationLocks } from './package-operation-lock.mjs';

export function transactionsRoot() {
  return resolve(process.env.DSH_TRANSACTION_HOME || join(runtimeRoot(), 'transactions'));
}

function transactionPath(id) {
  const value = String(id || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error(`unsafe transaction id: ${value || '<empty>'}`);
  return join(transactionsRoot(), value);
}

async function writeJournal(root, journal) {
  await mkdir(root, { recursive: true });
  const file = join(root, 'journal.json');
  const temp = `${file}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  try {
    await writeFile(temp, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

function requestFromEntry(entry) {
  if (typeof entry === 'string') {
    const parsed = parsePackageSpec(entry, '*', 'plugin');
    return { id: parsed.id, type: parsed.type, version: parsed.version, channel: undefined };
  }
  if (!entry?.id) throw new Error('package plan entry requires id');
  return {
    id: String(entry.id),
    type: assertPackageType(entry.type || 'plugin'),
    version: String(entry.version || '*'),
    channel: entry.channel ? String(entry.channel) : undefined,
  };
}

export async function readPackagePlanDocument(file) {
  const path = resolve(file);
  const document = JSON.parse(await readFile(path, 'utf8'));
  const raw = document.packages || document.items || document.plugins || [];
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('package plan has no packages');
  return { file: path, name: document.name || null, packages: raw.map(requestFromEntry) };
}

export async function buildPackageTransaction(file, options = {}) {
  const document = await readPackagePlanDocument(file);
  const catalog = options.catalog || 'catalog/registry-v3.json';
  const sourceRegistry = await loadRegistryFile(catalog);
  const runtimeRegistry = await readRuntimeRegistry(options.registryFile);
  const selected = new Map();
  const roots = [];
  const preflights = [];

  for (const request of document.packages) {
    const spec = `${request.type}:${request.id}@${request.version}`;
    const preflight = preflightPackage(sourceRegistry, spec, {
      type: request.type,
      channel: request.channel,
      installed: runtimeRegistry.packages,
    });
    preflights.push(preflight);
    if (!preflight.allowed) throw new Error(`transaction preflight failed for ${packageKey(request.type, request.id)}: ${preflight.reasons.join('; ')}`);
    const root = resolvePackage(sourceRegistry, request.type, preflight.id, preflight.version, { channel: request.channel || preflight.channel || 'stable' });
    roots.push(root);
    const plan = buildDependencyPlan(sourceRegistry, root, {
      channel: request.channel || root.channel || 'stable',
      installed: runtimeRegistry.packages,
    });
    for (const pkg of plan.order) {
      const key = packageKey(pkg.type, pkg.id);
      const previous = selected.get(key);
      if (previous && (previous.version !== pkg.version || previous.commit !== pkg.commit)) {
        throw new Error(`transaction dependency conflict: ${key} resolves to both ${previous.version}@${previous.commit} and ${pkg.version}@${pkg.commit}`);
      }
      selected.set(key, pkg);
    }
  }

  const packages = [...selected.values()];
  const permissions = inspectPermissions(packages.flatMap((pkg) => pkg.permissions || []));
  return {
    id: options.transactionId || randomUUID(),
    kind: options.kind || 'plan',
    document,
    catalog,
    sourceRegistry,
    runtimeRegistry,
    roots,
    preflights,
    packages,
    permissions,
    order: packages.map((pkg) => ({ type: pkg.type, id: pkg.id, key: packageKey(pkg.type, pkg.id), version: pkg.version, commit: pkg.commit })),
  };
}

function installedRecord(pkg, result, previous, transactionId) {
  const base = previous || createRuntimePackageRecord(pkg.type, pkg.id, pkg.version);
  return recordRuntimeEvent({
    ...base,
    id: pkg.id,
    type: pkg.type,
    version: pkg.version,
    state: 'pending-restart',
    channel: pkg.channel || previous?.channel || 'stable',
    path: result.final_target,
    source: pkg.source,
    commit: pkg.commit,
    capabilities: pkg.capabilities || [],
    dependencies: pkg.dependencies || [],
    permissions: pkg.permissions || [],
    permission_policy: pkg.permission_policy || null,
    runtime: pkg.runtime || {},
    type_config: pkg.type_config || null,
    compatibility: pkg.compatibility || {},
    publisher: pkg.publisher || null,
    security: pkg.security || null,
    conflicts: pkg.conflicts || [],
    replaces: pkg.replaces || [],
    provides: pkg.provides || [],
    installed_at: new Date().toISOString(),
    enabled: previous?.enabled ?? true,
    activated: false,
    binding: null,
    restart_required: true,
    health: null,
    rollback: previous && result.rollback_path ? {
      previous_version: previous.version,
      previous_commit: previous.commit,
      backup_path: result.rollback_path,
      created_at: new Date().toISOString(),
    } : null,
  }, 'transaction-install-complete', { transaction_id: transactionId, version: pkg.version, commit: pkg.commit });
}

function identity(record) {
  if (!record) return null;
  return {
    type: record.type || record.package_type || 'plugin',
    id: record.id,
    version: record.version,
    commit: record.commit || record.source?.commit,
  };
}

function sameIdentity(left, right) {
  if (!left || !right) return false;
  return left.type === right.type
    && left.id === right.id
    && left.version === right.version
    && String(left.commit || '').toLowerCase() === String(right.commit || '').toLowerCase();
}

async function installedIdentity(path) {
  if (!await pathExists(path)) return null;
  return identity(await readInstallLock(path));
}

function movePhase(move) {
  return move.phase || 'done';
}

function transactionCandidate(journal, move) {
  return (journal.order || []).find((candidate) => candidate.type === move.type && candidate.id === move.id) || null;
}

function originalCandidate(journal, move) {
  if (!move.had_previous && move.had_previous !== undefined) return null;
  const snapshot = journal.registry_snapshot;
  if (!snapshot) return null;
  return identity(getRuntimePackage(snapshot, move.type, move.id, { includeRemoved: true }));
}

function recoveryConflict(message, details = {}) {
  const error = new Error(message);
  error.code = 'DSH_TRANSACTION_RECOVERY_CONFLICT';
  Object.assign(error, details);
  return error;
}

async function inspectRecoveryMove(move, journal) {
  const phase = movePhase(move);
  const target = transactionCandidate(journal, move);
  if (!target) throw recoveryConflict(`transaction journal is missing package identity for ${move.type}:${move.id}`);
  const original = originalCandidate(journal, move);
  const hadPrevious = move.had_previous ?? Boolean(original);
  const finalIdentity = await installedIdentity(move.final_target);
  const backupIdentity = move.backup_target ? await installedIdentity(move.backup_target) : null;
  const rollbackIdentity = move.rollback_path ? await installedIdentity(move.rollback_path) : null;
  const finalIsTransaction = sameIdentity(finalIdentity, target);
  const finalIsOriginal = hadPrevious && sameIdentity(finalIdentity, original);

  if (phase === 'backup-move') {
    if (finalIdentity && !backupIdentity) {
      if (!finalIsOriginal) throw recoveryConflict(`transaction recovery found unexpected final package for ${move.type}:${move.id}`, { phase });
      return { move, action: 'none' };
    }
    if (!finalIdentity && backupIdentity) {
      if (!sameIdentity(backupIdentity, original)) throw recoveryConflict(`transaction backup identity mismatch for ${move.type}:${move.id}`, { phase });
      return { move, action: 'restore', restore_from: move.backup_target };
    }
    throw recoveryConflict(`transaction backup phase is ambiguous for ${move.type}:${move.id}`, { phase });
  }

  if (phase === 'stage-move') {
    if (hadPrevious) {
      if (!backupIdentity || !sameIdentity(backupIdentity, original)) {
        throw recoveryConflict(`transaction backup is missing or invalid for ${move.type}:${move.id}`, { phase });
      }
      if (finalIdentity && !finalIsTransaction) {
        throw recoveryConflict(`transaction staged package identity mismatch for ${move.type}:${move.id}`, { phase });
      }
      return { move, action: 'restore', restore_from: move.backup_target, remove_final: Boolean(finalIdentity) };
    }
    if (finalIdentity && !finalIsTransaction) {
      throw recoveryConflict(`transaction staged package identity mismatch for ${move.type}:${move.id}`, { phase });
    }
    return { move, action: finalIdentity ? 'remove' : 'none' };
  }

  if (!['rollback-move', 'done'].includes(phase)) {
    throw recoveryConflict(`unsupported transaction recovery phase ${phase} for ${move.type}:${move.id}`, { phase });
  }

  if (!hadPrevious) {
    if (finalIdentity && !finalIsTransaction) {
      throw recoveryConflict(`transaction final package identity mismatch for ${move.type}:${move.id}`, { phase });
    }
    return { move, action: finalIdentity ? 'remove' : 'none' };
  }

  if (finalIsOriginal) return { move, action: 'none' };
  if (finalIdentity && !finalIsTransaction) {
    throw recoveryConflict(`transaction final package identity mismatch for ${move.type}:${move.id}`, { phase });
  }

  if (backupIdentity) {
    if (!sameIdentity(backupIdentity, original)) throw recoveryConflict(`transaction backup identity mismatch for ${move.type}:${move.id}`, { phase });
    return { move, action: 'restore', restore_from: move.backup_target, remove_final: Boolean(finalIdentity) };
  }
  if (rollbackIdentity) {
    if (!sameIdentity(rollbackIdentity, original)) throw recoveryConflict(`transaction rollback identity mismatch for ${move.type}:${move.id}`, { phase });
    return { move, action: 'restore', restore_from: move.rollback_path, remove_final: Boolean(finalIdentity) };
  }
  throw recoveryConflict(`transaction original package cannot be recovered for ${move.type}:${move.id}`, { phase });
}

async function restoreMoves(moves, journal) {
  const inspections = [];
  for (const move of moves || []) inspections.push(await inspectRecoveryMove(move, journal));

  for (const item of inspections.reverse()) {
    const { move } = item;
    if (item.action === 'none') continue;
    if (item.action === 'remove') {
      await rm(move.final_target, { recursive: true, force: true });
      continue;
    }
    if (item.remove_final) await rm(move.final_target, { recursive: true, force: true });
    if (!item.restore_from || !await pathExists(item.restore_from)) {
      throw recoveryConflict(`transaction restore source disappeared for ${move.type}:${move.id}`);
    }
    await mkdir(dirname(move.final_target), { recursive: true });
    await rename(item.restore_from, move.final_target);
  }
}

function transactionRecorded(registry, journal) {
  if (!journal?.id || !Array.isArray(journal.order) || journal.order.length === 0) return false;
  return journal.order.every((candidate) => {
    const record = getRuntimePackage(registry, candidate.type, candidate.id, { includeRemoved: true });
    return Boolean(record && (record.history || []).some((entry) => entry.transaction_id === journal.id && entry.event === 'transaction-install-complete'));
  });
}

function journalPayload(transaction, moves, state = 'committing', extra = {}) {
  return {
    id: transaction.id,
    state,
    kind: transaction.kind,
    registry_file: extra.registry_file ?? null,
    registry_snapshot: transaction.runtimeRegistry,
    expected_generation: transaction.runtimeRegistry.generation,
    order: transaction.order,
    moves,
    ...extra,
  };
}

export async function executePackageTransaction(file, options = {}) {
  const transaction = await buildPackageTransaction(file, options);
  if (transaction.permissions.requires_consent && options.approved !== true) {
    const details = [...transaction.permissions.dangerous, ...transaction.permissions.unknown].join(', ');
    const error = new Error(`explicit permission consent required before transaction executes: ${details}`);
    error.code = 'DSH_PERMISSION_CONSENT_REQUIRED';
    error.permissionReport = transaction.permissions;
    throw error;
  }
  if (options.dryRun) {
    return {
      id: transaction.id,
      kind: transaction.kind,
      file: transaction.document.file,
      dry_run: true,
      order: transaction.order,
      permissions: transaction.permissions,
      restart_required: false,
    };
  }

  return withPackageOperationLocks(transaction.packages, async () => {
    const root = transactionPath(transaction.id);
    const staged = [];
    const moves = [];
    let nextRegistry = transaction.runtimeRegistry;
    let registryCommitted = false;

    try {
    await writeJournal(root, journalPayload(transaction, moves, 'staging', { registry_file: options.registryFile || null }));
    for (const pkg of transaction.packages) {
      const stageRoot = join(root, 'stage', pkg.type);
      const plan = await installPackage(pkg, {
        ...options,
        root: stageRoot,
        approved: true,
        operationLockHeld: true,
      });
      const stagedTarget = join(stageRoot, safePackageId(pkg.id));
      staged.push({ pkg, plan, staged_target: stagedTarget });
    }

    const latest = await readRuntimeRegistry(options.registryFile);
    if (latest.generation !== transaction.runtimeRegistry.generation) {
      const error = new Error(`runtime registry changed during transaction: expected generation ${transaction.runtimeRegistry.generation}, current ${latest.generation}`);
      error.code = 'DSH_REGISTRY_CONFLICT';
      throw error;
    }

    await writeJournal(root, journalPayload(transaction, moves, 'committing', { registry_file: options.registryFile || null }));

    for (const item of staged) {
      const { pkg, staged_target: stagedTarget } = item;
      const current = getRuntimePackage(nextRegistry, pkg.type, pkg.id, { includeRemoved: true });
      const finalTarget = current?.path || packagePath(pkg.type, pkg.id);
      const backupTarget = join(root, 'backup', pkg.type, safePackageId(pkg.id));
      const rollbackPath = `${finalTarget}.backup`;
      const hadPrevious = await pathExists(finalTarget);
      const move = {
        type: pkg.type,
        id: pkg.id,
        final_target: finalTarget,
        backup_target: backupTarget,
        rollback_path: hadPrevious ? rollbackPath : null,
        had_previous: hadPrevious,
        phase: hadPrevious ? 'backup-move' : 'stage-move',
      };
      moves.push(move);
      await writeJournal(root, journalPayload(transaction, moves, 'committing', { registry_file: options.registryFile || null }));

      await mkdir(dirname(finalTarget), { recursive: true });
      await mkdir(dirname(backupTarget), { recursive: true });
      if (hadPrevious) await rename(finalTarget, backupTarget);

      move.phase = 'stage-move';
      await writeJournal(root, journalPayload(transaction, moves, 'committing', { registry_file: options.registryFile || null }));
      await rename(stagedTarget, finalTarget);

      if (hadPrevious) {
        move.phase = 'rollback-move';
        await writeJournal(root, journalPayload(transaction, moves, 'committing', { registry_file: options.registryFile || null }));
        await rm(rollbackPath, { recursive: true, force: true });
        await rename(backupTarget, rollbackPath);
      }

      move.phase = 'done';
      await writeJournal(root, journalPayload(transaction, moves, 'committing', { registry_file: options.registryFile || null }));
      item.plan.final_target = finalTarget;
      item.plan.rollback_path = hadPrevious ? rollbackPath : null;
      nextRegistry = upsertRuntimePackage(nextRegistry, installedRecord(pkg, item.plan, current?.state === 'removed' ? null : current, transaction.id));
    }

    const written = await writeRuntimeRegistry(nextRegistry, options.registryFile);
    registryCommitted = true;
    await writeJournal(root, {
      id: transaction.id,
      state: 'committed',
      generation: written.generation,
      registry_file: options.registryFile || null,
      order: transaction.order,
      moves,
    }).catch(() => {});
    await rm(root, { recursive: true, force: true }).catch(() => {});
    return {
      id: transaction.id,
      kind: transaction.kind,
      file: transaction.document.file,
      committed: true,
      generation: written.generation,
      order: transaction.order,
      restart_required: true,
    };
    } catch (error) {
      if (!registryCommitted) {
        try {
          await restoreMoves(moves, journalPayload(transaction, moves, 'recovery-required', { registry_file: options.registryFile || null }));
          await rm(root, { recursive: true, force: true });
        } catch (recoveryError) {
          error.recovery_error = recoveryError.message;
          await writeJournal(root, journalPayload(transaction, moves, 'recovery-required', {
            registry_file: options.registryFile || null,
            error: error.message,
            recovery_error: recoveryError.message,
          })).catch(() => {});
        }
      }
      throw error;
    }
  }, options);
}

export async function recoverPackageTransactions(options = {}) {
  const base = transactionsRoot();
  const defaultRegistryFile = resolve(registryPath());
  const requestedRegistryFile = resolve(options.registryFile || defaultRegistryFile);
  const registryWasExplicit = Boolean(options.registryFile);
  let entries;
  try { entries = await readdir(base, { withFileTypes: true }); } catch (error) {
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
        // Other local transaction implementations may use the same parent
        // directory without this journal format. They are not recoverable by
        // this module and must not make an unrelated startup unhealthy.
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      const journalRegistryFile = journal.registry_file ? resolve(journal.registry_file) : null;
      // A shared transaction directory may contain journals for more than one
      // explicitly selected runtime Registry. Never let startup for one
      // Registry recover, delete, or report conflicts from another Registry.
      // Legacy journals without a target are only safe for the process' own
      // default Registry; an explicit alternate Registry must not claim them.
      if (journalRegistryFile && journalRegistryFile !== requestedRegistryFile) continue;
      if (!journalRegistryFile && registryWasExplicit && requestedRegistryFile !== defaultRegistryFile) continue;
      if (journal.state === 'committed') {
        await rm(root, { recursive: true, force: true });
        continue;
      }
      const registryFile = journalRegistryFile || requestedRegistryFile;
      const currentRegistry = await readRuntimeRegistry(registryFile);
      if (transactionRecorded(currentRegistry, journal)) {
        await rm(root, { recursive: true, force: true });
        recovered.push({ id: journal.id || entry.name, state: 'committed-detected', generation: currentRegistry.generation });
        continue;
      }

      const expectedGeneration = Number(journal.expected_generation);
      if (!Number.isFinite(expectedGeneration)) {
        throw recoveryConflict(`transaction journal has no valid expected generation: ${journal.id || entry.name}`);
      }
      if (currentRegistry.generation !== expectedGeneration) {
        throw recoveryConflict(
          `runtime registry advanced after transaction crash: expected generation ${expectedGeneration}, current ${currentRegistry.generation}`,
          { expected_generation: expectedGeneration, current_generation: currentRegistry.generation },
        );
      }

      await withPackageOperationLocks(journal.order || [], () => restoreMoves(journal.moves || [], journal), { registryFile });
      await rm(root, { recursive: true, force: true });
      recovered.push({
        id: journal.id || entry.name,
        state: 'rolled-back',
        interrupted_state: journal.state || 'unknown',
        generation: currentRegistry.generation,
      });
    } catch (error) {
      recovered.push({
        id: entry.name,
        state: 'conflict',
        error: error.message,
        code: error.code || null,
        expected_generation: error.expected_generation ?? null,
        current_generation: error.current_generation ?? null,
      });
    }
  }
  return { recovered };
}
