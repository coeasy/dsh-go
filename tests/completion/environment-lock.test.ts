import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { artifactIntegrity } from '../../scripts/checksum.mjs';
import { snapshotDirectory, verifyCasSnapshot } from '../../runtime/cas-store.mjs';
import { createEnvironmentLock, restoreEnvironmentLock, verifyEnvironmentLock } from '../../runtime/environment-lock.mjs';
import { installPlugin } from '../../runtime/installer.mjs';
import { getRuntimePackage, readRuntimeRegistry, upsertRuntimePackage, writeRuntimeRegistry } from '../../runtime/registry.mjs';
import { readInstallLock } from '../../runtime/verifier.mjs';

function git(repo: string, args: string[]) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

async function fixturePackage() {
  const repo = await mkdtemp(join(tmpdir(), 'dsh-env-lock-fixture-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'env-lock@test.local']);
  git(repo, ['config', 'user.name', 'Environment Lock Test']);
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'env-lock-fixture', version: '1.2.3', type: 'module' }, null, 2));
  await writeFile(join(repo, 'dsh-package.json'), JSON.stringify({ id: 'env-lock-fixture', version: '1.2.3', type: 'plugin' }, null, 2));
  await writeFile(join(repo, 'index.mjs'), 'export const value = 123;\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'fixture']);
  return { repo, commit: git(repo, ['rev-parse', 'HEAD']) };
}

function resolved(commit: string) {
  const source = { provider: 'github', repo: 'owner/env-lock-fixture', ref: 'main', commit };
  const integrity = artifactIntegrity({ version: '1.2.3', source });
  return {
    id: 'env-lock-fixture', version: '1.2.3', channel: 'stable',
    repo: source.repo, ref: source.ref, commit, source,
    artifact: { kind: 'git-source', integrity }, integrity,
    runtime: { type: 'plugin' }, capabilities: ['plugin'], dependencies: [], permissions: [],
  };
}

describe('CAS and environment lock', () => {
  it('stores immutable full Git snapshots and detects CAS corruption', async () => {
    const { repo } = await fixturePackage();
    const store = await mkdtemp(join(tmpdir(), 'dsh-cas-store-'));
    const first = await snapshotDirectory(repo, { root: store });
    expect(first.digest).toMatch(/^[0-9a-f]{64}$/);
    expect((await verifyCasSnapshot(first.digest, { root: store })).ok).toBe(true);
    const second = await snapshotDirectory(repo, { root: store });
    expect(second.digest).toBe(first.digest);
    expect(second.cache_hit).toBe(true);
    await writeFile(join(first.path, 'index.mjs'), 'export const value = 999;\n');
    const corrupted = await verifyCasSnapshot(first.digest, { root: store });
    expect(corrupted.ok).toBe(false);
    expect(corrupted.actual_digest).not.toBe(first.digest);
  }, 20_000);

  it('locks, detects drift, restores exactly from CAS, prunes extras, and returns packages to pending-restart', async () => {
    const { repo, commit } = await fixturePackage();
    const root = await mkdtemp(join(tmpdir(), 'dsh-env-lock-runtime-'));
    const installRoot = join(root, 'plugins');
    const runtimeFile = join(root, 'registry', 'runtime.json');
    const lockFile = join(root, 'dsh.lock');
    const storeRoot = join(root, 'store', 'sha256');
    const installed = await installPlugin(resolved(commit), { root: installRoot, repositoryUrl: repo });
    const installLock = await readInstallLock(installed.target);
    expect(installLock.source.commit).toBe(commit);

    await writeRuntimeRegistry({
      schema_version: 3,
      generation: 0,
      packages: [{
        type: 'plugin', id: 'env-lock-fixture', version: '1.2.3', channel: 'stable', state: 'active',
        enabled: true, activated: true, restart_required: false, path: installed.target, commit, source: installLock.source,
        dependencies: [], history: [],
      }],
    }, runtimeFile);

    const created = await createEnvironmentLock({ registryFile: runtimeFile, lockFile, storeRoot });
    expect(created.packages).toBe(1);
    expect(created.lock.packages[0].content.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(await readFile(lockFile, 'utf8')).content_hash).toBe(created.content_hash);

    await rm(installed.target, { recursive: true, force: true });
    const extraPath = join(root, 'plugins', 'extra-package');
    await mkdir(extraPath, { recursive: true });
    await writeFile(join(extraPath, 'orphan.txt'), 'extra\n');
    const current = await readRuntimeRegistry(runtimeFile);
    await writeRuntimeRegistry(upsertRuntimePackage(current, {
      type: 'plugin', id: 'extra-package', version: '9.9.9', state: 'active', enabled: true,
      activated: true, restart_required: false, path: extraPath, dependencies: [], history: [],
    }), runtimeFile);

    const drifted = await verifyEnvironmentLock({ registryFile: runtimeFile, lockFile, storeRoot });
    expect(drifted.ok).toBe(false);
    expect(drifted.packages[0].installed.exists).toBe(false);
    expect(drifted.extras.map((item: any) => item.key)).toContain('plugin:extra-package');

    const dryRun = await restoreEnvironmentLock({ registryFile: runtimeFile, lockFile, storeRoot, dryRun: true });
    expect(dryRun.executed).toBe(false);
    expect(dryRun.prune).toEqual([expect.objectContaining({ key: 'plugin:extra-package' })]);

    await expect(restoreEnvironmentLock({ registryFile: runtimeFile, lockFile, storeRoot }))
      .rejects.toMatchObject({ code: 'DSH_RESTORE_APPROVAL_REQUIRED' });

    const restored: any = await restoreEnvironmentLock({ registryFile: runtimeFile, lockFile, storeRoot, approved: true });
    expect(restored.executed).toBe(true);
    expect(restored.restored).toBe(1);
    expect(restored.pruned).toBe(1);
    expect(restored.auto_restart).toBe(false);
    expect(git(installed.target, ['rev-parse', 'HEAD'])).toBe(commit);
    expect((await readInstallLock(installed.target)).source.commit).toBe(commit);

    const after = await readRuntimeRegistry(runtimeFile);
    const locked = getRuntimePackage(after, 'plugin', 'env-lock-fixture', { includeRemoved: true });
    const extra = getRuntimePackage(after, 'plugin', 'extra-package', { includeRemoved: true });
    expect(locked).toMatchObject({ state: 'pending-restart', activated: false, restart_required: true });
    expect(extra).toMatchObject({ state: 'removed', enabled: false, activated: false });
    expect(await verifyEnvironmentLock({ registryFile: runtimeFile, lockFile, storeRoot })).toMatchObject({ ok: true, extras: [] });
  }, 30_000);
});
