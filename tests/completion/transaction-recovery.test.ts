import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recoverPackageTransactions } from '../../runtime/transaction.mjs';
import { readInstallLock } from '../../runtime/verifier.mjs';
import { readRuntimeRegistry } from '../../runtime/registry.mjs';

const ENV_KEYS = ['DSH_RUNTIME_HOME', 'DSH_RUNTIME_REGISTRY', 'DSH_TRANSACTION_HOME', 'DSH_REGISTRY'] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

let root: string;
let registryFile: string;
let transactionHome: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-transaction-recovery-'));
  registryFile = join(root, 'registry.json');
  transactionHome = join(root, 'transactions');
  process.env.DSH_RUNTIME_HOME = root;
  process.env.DSH_RUNTIME_REGISTRY = registryFile;
  process.env.DSH_TRANSACTION_HOME = transactionHome;
  delete process.env.DSH_REGISTRY;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

function record(type: 'plugin' | 'mcp' | 'skill' | 'agent', id: string, version: string, commit: string, path?: string, history: any[] = []) {
  return {
    type,
    id,
    version,
    state: 'installed',
    channel: 'stable',
    enabled: true,
    activated: false,
    restart_required: true,
    path,
    source: { provider: 'github', repo: `owner/${id}`, commit },
    commit,
    history,
  };
}

async function writeRegistry(generation: number, packages: any[]) {
  await writeFile(registryFile, `${JSON.stringify({ schema_version: 3, generation, packages })}\n`);
}

async function writeInstallLock(path: string, type: 'plugin' | 'mcp' | 'skill' | 'agent', id: string, version: string, commit: string) {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, '.dsh-install.json'), `${JSON.stringify({
    runtime_registry_version: 3,
    type,
    package_type: type,
    id,
    version,
    channel: 'stable',
    source: { provider: 'github', repo: `owner/${id}`, commit },
    runtime: {},
    capabilities: [],
    dependencies: [],
    permissions: [],
    compatibility: {},
  })}\n`);
}

async function writeJournal(id: string, journal: any) {
  const dir = join(transactionHome, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'journal.json'), `${JSON.stringify({ id, ...journal }, null, 2)}\n`);
  return dir;
}

describe('transaction crash recovery', () => {
  it('refuses to overwrite a Registry generation that advanced after the crash', async () => {
    const commit = 'c'.repeat(40);
    await writeRegistry(2, [record('skill', 'later-change', '0.1.0', commit)]);
    const journalDir = await writeJournal('txn-conflict', {
      state: 'committing',
      expected_generation: 1,
      registry_file: registryFile,
      registry_snapshot: { schema_version: 3, generation: 1, packages: [] },
      order: [{ type: 'plugin', id: 'planned', version: '0.1.0', commit: 'a'.repeat(40) }],
      moves: [],
    });

    const result = await recoverPackageTransactions({ registryFile });
    expect(result.recovered).toHaveLength(1);
    expect(result.recovered[0]).toMatchObject({
      id: 'txn-conflict',
      state: 'conflict',
      code: 'DSH_TRANSACTION_RECOVERY_CONFLICT',
      expected_generation: 1,
      current_generation: 2,
    });
    expect((await readRuntimeRegistry(registryFile)).generation).toBe(2);
    expect((await readRuntimeRegistry(registryFile)).packages[0].id).toBe('later-change');
    await expect(access(join(journalDir, 'journal.json'))).resolves.toBeUndefined();
  });

  it('detects a committed transaction from history even after a later package update', async () => {
    const transactionCommit = 'a'.repeat(40);
    const laterCommit = 'b'.repeat(40);
    await writeRegistry(3, [record('plugin', 'demo', '0.2.0', laterCommit, undefined, [
      { event: 'transaction-install-complete', transaction_id: 'txn-committed', at: new Date().toISOString() },
      { event: 'update-complete', version: '0.2.0', at: new Date().toISOString() },
    ])]);
    const journalDir = await writeJournal('txn-committed', {
      state: 'committing',
      expected_generation: 1,
      registry_file: registryFile,
      registry_snapshot: { schema_version: 3, generation: 1, packages: [] },
      order: [{ type: 'plugin', id: 'demo', version: '0.1.0', commit: transactionCommit }],
      moves: [],
    });

    const result = await recoverPackageTransactions({ registryFile });
    expect(result.recovered[0]).toMatchObject({ id: 'txn-committed', state: 'committed-detected', generation: 3 });
    await expect(access(journalDir)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readRuntimeRegistry(registryFile)).packages[0].version).toBe('0.2.0');
  });

  it('rolls back a partially moved package without rewriting the Registry snapshot', async () => {
    const oldCommit = '1'.repeat(40);
    const newCommit = '2'.repeat(40);
    const finalTarget = join(root, 'plugins', 'demo');
    const journalDir = join(transactionHome, 'txn-move');
    const backupTarget = join(journalDir, 'backup', 'plugin', 'demo');
    const rollbackPath = `${finalTarget}.backup`;
    const original = record('plugin', 'demo', '0.1.0', oldCommit, finalTarget);
    await writeRegistry(7, [original]);
    await writeInstallLock(finalTarget, 'plugin', 'demo', '0.2.0', newCommit);
    await writeInstallLock(backupTarget, 'plugin', 'demo', '0.1.0', oldCommit);
    await writeJournal('txn-move', {
      state: 'committing',
      expected_generation: 7,
      registry_file: registryFile,
      registry_snapshot: { schema_version: 3, generation: 7, packages: [original] },
      order: [{ type: 'plugin', id: 'demo', version: '0.2.0', commit: newCommit }],
      moves: [{
        type: 'plugin',
        id: 'demo',
        final_target: finalTarget,
        backup_target: backupTarget,
        rollback_path: rollbackPath,
        had_previous: true,
        phase: 'stage-move',
      }],
    });

    const result = await recoverPackageTransactions({ registryFile });
    expect(result.recovered[0]).toMatchObject({ id: 'txn-move', state: 'rolled-back', generation: 7 });
    const lock = await readInstallLock(finalTarget);
    expect(lock.version).toBe('0.1.0');
    expect(lock.source.commit).toBe(oldCommit);
    expect((await readRuntimeRegistry(registryFile)).generation).toBe(7);
    expect(JSON.parse(await readFile(registryFile, 'utf8')).generation).toBe(7);
    await expect(access(journalDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not recover a journal belonging to another explicitly selected Registry', async () => {
    const foreignRegistry = join(root, 'foreign-registry.json');
    const journalDir = await writeJournal('txn-foreign', {
      state: 'committing',
      expected_generation: 0,
      registry_file: foreignRegistry,
      registry_snapshot: { schema_version: 3, generation: 0, packages: [] },
      order: [{ type: 'plugin', id: 'foreign', version: '0.1.0', commit: 'f'.repeat(40) }],
      moves: [],
    });

    const result = await recoverPackageTransactions({ registryFile });
    expect(result.recovered).toEqual([]);
    await expect(access(join(journalDir, 'journal.json'))).resolves.toBeUndefined();
  });

  it('does not claim an unbound legacy journal for an alternate Registry', async () => {
    const selectedRegistry = join(root, 'selected-registry.json');
    const journalDir = await writeJournal('txn-legacy', {
      state: 'committing',
      expected_generation: 0,
      registry_snapshot: { schema_version: 3, generation: 0, packages: [] },
      order: [{ type: 'plugin', id: 'legacy', version: '0.1.0', commit: 'e'.repeat(40) }],
      moves: [],
    });

    const result = await recoverPackageTransactions({ registryFile: selectedRegistry });
    expect(result.recovered).toEqual([]);
    await expect(access(join(journalDir, 'journal.json'))).resolves.toBeUndefined();
  });

  it('ignores non-journal transaction directories owned by another local workflow', async () => {
    const directory = join(transactionHome, 'environment-restore-in-progress');
    await mkdir(directory, { recursive: true });

    const result = await recoverPackageTransactions({ registryFile });
    expect(result.recovered).toEqual([]);
    await expect(access(directory)).resolves.toBeUndefined();
  });
});
