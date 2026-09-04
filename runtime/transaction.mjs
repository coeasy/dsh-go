import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { packageKey } from '../packages/protocol-core/index.mjs';
import { installPackage } from './installer.mjs';
import { createRuntimePackageRecord, recordRuntimeEvent } from './lifecycle.mjs';
import {
  getRuntimePackage,
  pathExists,
  readRuntimeRegistry,
  runtimeRoot,
  upsertRuntimePackage,
  writeRuntimeRegistry,
} from './registry.mjs';

export const TRANSACTION_SCHEMA_VERSION = 2;

export function transactionsRoot() {
  return resolve(process.env.DSH_TRANSACTION_HOME || join(runtimeRoot(), 'transactions-v2'));
}

function transactionDir(id) {
  const value = String(id || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error(`unsafe transaction id: ${value || '<empty>'}`);
  return join(transactionsRoot(), value);
}

async function writeJournal(dir, journal) {
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'journal.json');
  const temp = `${file}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  try {
    await writeFile(temp, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

function recordFor(node, result, plan, transactionId, previous) {
  const base = createRuntimePackageRecord(node.type, node.id, node.version, {
    enabled: previous?.enabled ?? true,
    history: previous?.history || undefined,
  });
  return recordRuntimeEvent({
    ...base,
    id: node.id,
    type: node.type,
    version: node.version,
    channel: node.channel || 'stable',
    state: 'pending-restart',
    enabled: previous?.enabled ?? true,
    activated: false,
    restart_required: true,
    path: result.target,
    source: node.source,
    commit: node.commit,
    runtime: node.runtime || {},
    entrypoints: node.entrypoints || {},
    capabilities: node.capabilities || [],
    dependencies: node.dependencies || [],
    permissions: node.permissions || [],
    compatibility: node.compatibility || {},
    publisher: node.publisher || (node.publisher_id ? { id: node.publisher_id } : null),
    security: node.security || null,
    artifact: node.artifact || null,
    registry_revision: plan.registry_revision,
    resolution_hash: plan.resolution_hash,
    rollback: previous && result.backup ? {
      previous_version: previous.version,
      previous_commit: previous.commit || previous.source?.commit || null,
      backup_path: result.backup,
      created_at: new Date().toISOString(),
    } : null,
    health: { status: 'pending-restart', checked_at: new Date().toISOString() },
  }, 'transaction-install-complete', {
    transaction_id: transactionId,
    registry_revision: plan.registry_revision,
    resolution_hash: plan.resolution_hash,
  });
}

async function rollbackMoves(moves) {
  for (const move of [...moves].reverse()) {
    await rm(move.target, { recursive: true, force: true }).catch(() => {});
    if (move.backup && await pathExists(move.backup)) {
      await mkdir(resolve(move.target, '..'), { recursive: true }).catch(() => {});
      await rename(move.backup, move.target).catch((error) => {
        error.code = error.code || 'DSH_TRANSACTION_ROLLBACK_FAILED';
        throw error;
      });
    }
  }
}

function planCommitted(state, journal) {
  return (journal.order || []).every((key) => {
    const [type, ...idParts] = String(key).split(':');
    const record = getRuntimePackage(state, type, idParts.join(':'), { includeRemoved: true });
    return record
      && record.state !== 'removed'
      && record.resolution_hash === journal.resolution_hash
      && (record.history || []).some((entry) => entry.transaction_id === journal.id && entry.event === 'transaction-install-complete');
  });
}

/**
 * Execute one deterministic Resolution Plan V2 as a single Runtime State V4
 * commit. Filesystem moves are journaled before state publication so crashes
 * can be recovered without a partially published package graph.
 */
export async function executeResolutionTransaction(plan, options = {}) {
  if (!plan || plan.protocol_version !== 2 || !Array.isArray(plan.graph) || !Array.isArray(plan.order) || !plan.resolution_hash) {
    throw new Error('Resolution Plan V2 is required');
  }
  if (options.approved !== true) {
    const error = new Error('explicit local approval is required before a package transaction executes');
    error.code = 'DSH_PERMISSION_DENIED';
    throw error;
  }
  const transactionId = options.transactionId || randomUUID();
  const dir = transactionDir(transactionId);
  const snapshot = await readRuntimeRegistry(options.registryFile);
  const nodes = new Map(plan.graph.map((node) => [node.key, node]));
  const moves = [];
  const journal = {
    schema_version: TRANSACTION_SCHEMA_VERSION,
    id: transactionId,
    state: 'preparing',
    created_at: new Date().toISOString(),
    registry_file: options.registryFile || null,
    expected_generation: snapshot.generation,
    registry_revision: plan.registry_revision,
    resolution_hash: plan.resolution_hash,
    order: [...plan.order],
    moves,
  };
  await writeJournal(dir, journal);

  try {
    let nextState = snapshot;
    for (const key of plan.order) {
      const node = nodes.get(key);
      if (!node) throw new Error(`resolution plan is missing node: ${key}`);
      const previous = getRuntimePackage(snapshot, node.type, node.id, { includeRemoved: true });
      const result = await installPackage({
        ...node,
        repo: node.source?.repo,
        commit: node.commit,
        source: { ...(node.source || {}), provider: node.source?.provider || 'github', commit: node.commit },
        registry_revision: plan.registry_revision,
        resolution_hash: plan.resolution_hash,
      }, {
        ...options,
        root: options.rootByType?.[node.type] || options.root,
        approved: true,
        force: options.force === true || Boolean(previous && previous.state !== 'removed'),
      });
      const move = {
        key,
        type: node.type,
        id: node.id,
        target: result.target,
        backup: result.backup || null,
        had_previous: Boolean(previous && previous.state !== 'removed'),
      };
      moves.push(move);
      journal.state = 'installing';
      journal.moves = moves;
      journal.updated_at = new Date().toISOString();
      await writeJournal(dir, journal);
      nextState = upsertRuntimePackage(nextState, recordFor(node, result, plan, transactionId, previous));
    }

    journal.state = 'committing-state';
    journal.updated_at = new Date().toISOString();
    await writeJournal(dir, journal);
    const committed = await writeRuntimeRegistry(nextState, options.registryFile);
    journal.state = 'committed';
    journal.committed_generation = committed.generation;
    journal.committed_at = new Date().toISOString();
    await writeJournal(dir, journal);
    await rm(dir, { recursive: true, force: true });
    return {
      transaction_id: transactionId,
      changed: true,
      installed: [...plan.order],
      registry_generation: committed.generation,
      registry_revision: plan.registry_revision,
      resolution_hash: plan.resolution_hash,
      restart_required: true,
    };
  } catch (error) {
    journal.state = 'rolling-back';
    journal.error = error.message;
    journal.updated_at = new Date().toISOString();
    await writeJournal(dir, journal).catch(() => {});
    try {
      await rollbackMoves(moves);
      journal.state = 'rolled-back';
      journal.rolled_back_at = new Date().toISOString();
      await writeJournal(dir, journal).catch(() => {});
      await rm(dir, { recursive: true, force: true });
    } catch (rollbackError) {
      error.rollback_error = rollbackError.message;
      error.recovery_required = true;
      journal.state = 'recovery-required';
      journal.rollback_error = rollbackError.message;
      await writeJournal(dir, journal).catch(() => {});
    }
    throw error;
  }
}

export async function recoverPackageTransactions(options = {}) {
  const root = transactionsRoot();
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error?.code === 'ENOENT') return { recovered: [], healthy: true }; throw error; }
  const recovered = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    let journal;
    try { journal = JSON.parse(await readFile(join(dir, 'journal.json'), 'utf8')); }
    catch (error) { recovered.push({ id: entry.name, action: 'manual-recovery-required', error: `invalid journal: ${error.message}` }); continue; }
    if (journal.schema_version !== TRANSACTION_SCHEMA_VERSION) {
      recovered.push({ id: journal.id || entry.name, action: 'manual-recovery-required', error: 'unsupported transaction journal schema' });
      continue;
    }
    try {
      const state = await readRuntimeRegistry(journal.registry_file || options.registryFile);
      if (journal.state === 'committed' || planCommitted(state, journal)) {
        await rm(dir, { recursive: true, force: true });
        recovered.push({ id: journal.id, action: 'finalized-committed' });
        continue;
      }
      await rollbackMoves(journal.moves || []);
      await rm(dir, { recursive: true, force: true });
      recovered.push({ id: journal.id, action: 'rolled-back-uncommitted' });
    } catch (error) {
      recovered.push({ id: journal.id || entry.name, action: 'manual-recovery-required', error: error.message });
    }
  }
  return { recovered, healthy: recovered.every((item) => !item.error) };
}
