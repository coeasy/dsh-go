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
  runtimeRoot,
  upsertRuntimePackage,
  writeRuntimeRegistry,
} from './registry.mjs';
import { preflightPackage } from './preflight.mjs';

export function transactionsRoot() {
  return resolve(process.env.DSH_TRANSACTION_HOME || join(runtimeRoot(), 'transactions'));
}

function transactionPath(id) {
  return join(transactionsRoot(), id);
}

async function writeJournal(root, journal) {
  await mkdir(root, { recursive: true });
  const file = join(root, 'journal.json');
  const temp = `${file}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
  await rename(temp, file);
}

function requestFromEntry(entry) {
  if (typeof entry === 'string') {
    const parsed = parsePackageSpec(entry, '0.1.0', 'plugin');
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
    state: 'installed',
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

async function restoreMoves(moves) {
  for (const move of [...moves].reverse()) {
    await rm(move.final_target, { recursive: true, force: true });
    const restoreFrom = move.backup_target && await pathExists(move.backup_target)
      ? move.backup_target
      : move.rollback_path && await pathExists(move.rollback_path)
        ? move.rollback_path
        : null;
    if (restoreFrom) {
      await mkdir(dirname(move.final_target), { recursive: true });
      await rename(restoreFrom, move.final_target);
    }
  }
}

function transactionRecorded(registry, journal) {
  if (!journal?.id || !Array.isArray(journal.order) || journal.order.length === 0) return false;
  return journal.order.every((candidate) => {
    const record = getRuntimePackage(registry, candidate.type, candidate.id, { includeRemoved: true });
    if (!record || record.version !== candidate.version || record.commit !== candidate.commit) return false;
    return (record.history || []).some((entry) => entry.transaction_id === journal.id && entry.event === 'transaction-install-complete');
  });
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

  const root = transactionPath(transaction.id);
  const staged = [];
  const moves = [];
  let nextRegistry = transaction.runtimeRegistry;
  let registryCommitted = false;
  await writeJournal(root, {
    id: transaction.id,
    state: 'staging',
    kind: transaction.kind,
    registry_file: options.registryFile || null,
    registry_snapshot: transaction.runtimeRegistry,
    expected_generation: transaction.runtimeRegistry.generation,
    order: transaction.order,
    moves,
  });

  try {
    for (const pkg of transaction.packages) {
      const stageRoot = join(root, 'stage', pkg.type);
      const plan = await installPackage(pkg, { root: stageRoot, approved: true });
      const stagedTarget = join(stageRoot, safePackageId(pkg.id));
      staged.push({ pkg, plan, staged_target: stagedTarget });
    }

    const latest = await readRuntimeRegistry(options.registryFile);
    if (latest.generation !== transaction.runtimeRegistry.generation) {
      const error = new Error(`runtime registry changed during transaction: expected generation ${transaction.runtimeRegistry.generation}, current ${latest.generation}`);
      error.code = 'DSH_REGISTRY_CONFLICT';
      throw error;
    }

    await writeJournal(root, {
      id: transaction.id,
      state: 'committing',
      kind: transaction.kind,
      registry_file: options.registryFile || null,
      registry_snapshot: transaction.runtimeRegistry,
      expected_generation: transaction.runtimeRegistry.generation,
      order: transaction.order,
      moves,
    });

    for (const item of staged) {
      const { pkg, staged_target: stagedTarget } = item;
      const current = getRuntimePackage(nextRegistry, pkg.type, pkg.id, { includeRemoved: true });
      const finalTarget = current?.path || packagePath(pkg.type, pkg.id);
      const backupTarget = join(root, 'backup', pkg.type, safePackageId(pkg.id));
      const rollbackPath = `${finalTarget}.backup`;
      await mkdir(dirname(finalTarget), { recursive: true });
      await mkdir(dirname(backupTarget), { recursive: true });
      if (await pathExists(finalTarget)) await rename(finalTarget, backupTarget);
      await rename(stagedTarget, finalTarget);
      if (await pathExists(backupTarget)) {
        await rm(rollbackPath, { recursive: true, force: true });
        await rename(backupTarget, rollbackPath);
      }
      const move = { type: pkg.type, id: pkg.id, final_target: finalTarget, backup_target: backupTarget, rollback_path: current ? rollbackPath : null };
      moves.push(move);
      item.plan.final_target = finalTarget;
      item.plan.rollback_path = current ? rollbackPath : null;
      nextRegistry = upsertRuntimePackage(nextRegistry, installedRecord(pkg, item.plan, current?.state === 'removed' ? null : current, transaction.id));
      await writeJournal(root, {
        id: transaction.id,
        state: 'committing',
        kind: transaction.kind,
        registry_file: options.registryFile || null,
        registry_snapshot: transaction.runtimeRegistry,
        expected_generation: transaction.runtimeRegistry.generation,
        order: transaction.order,
        moves,
      });
    }

    const written = await writeRuntimeRegistry(nextRegistry, options.registryFile);
    registryCommitted = true;
    await writeJournal(root, { id: transaction.id, state: 'committed', generation: written.generation, order: transaction.order, moves }).catch(() => {});
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
    if (!registryCommitted) await restoreMoves(moves).catch(() => {});
    if (!registryCommitted) await rm(root, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function recoverPackageTransactions(options = {}) {
  const base = transactionsRoot();
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
      const journal = JSON.parse(await readFile(join(root, 'journal.json'), 'utf8'));
      if (journal.state === 'committed') {
        await rm(root, { recursive: true, force: true });
        continue;
      }
      const currentRegistry = await readRuntimeRegistry(journal.registry_file || options.registryFile);
      if (transactionRecorded(currentRegistry, journal)) {
        await rm(root, { recursive: true, force: true });
        recovered.push({ id: journal.id || entry.name, state: 'committed-detected' });
        continue;
      }
      await restoreMoves(journal.moves || []);
      if (journal.registry_snapshot) {
        await writeRuntimeRegistry(journal.registry_snapshot, journal.registry_file || options.registryFile, { force: true });
      }
      await rm(root, { recursive: true, force: true });
      recovered.push({ id: journal.id || entry.name, state: journal.state || 'unknown' });
    } catch (error) {
      recovered.push({ id: entry.name, error: error.message });
    }
  }
  return { recovered };
}
