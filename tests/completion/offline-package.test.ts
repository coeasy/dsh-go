import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { artifactIntegrity } from '../../scripts/checksum.mjs';
import { installPlugin } from '../../runtime/installer.mjs';
import { exportOfflinePackage, installOfflinePackage, offlineBundleHash, readOfflinePackage } from '../../runtime/offline-package.mjs';
import { getRuntimePackage, readRuntimeRegistry, writeRuntimeRegistry } from '../../runtime/registry.mjs';
import { readInstallLock } from '../../runtime/verifier.mjs';

function git(repo: string, args: string[]) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

async function setup() {
  const repo = await mkdtemp(join(tmpdir(), 'dsh-offline-fixture-'));
  const root = await mkdtemp(join(tmpdir(), 'dsh-offline-root-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'offline@test.local']);
  git(repo, ['config', 'user.name', 'Offline Package Test']);
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'offline-fixture', version: '3.1.4' }, null, 2));
  await writeFile(join(repo, 'dsh-package.json'), JSON.stringify({ id: 'offline-fixture', type: 'plugin', version: '3.1.4' }, null, 2));
  await writeFile(join(repo, 'index.mjs'), 'export const offline = true;\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'fixture']);
  const commit = git(repo, ['rev-parse', 'HEAD']);
  const source = { provider: 'github', repo: 'owner/offline-fixture', ref: 'main', commit };
  const integrity = artifactIntegrity({ version: '3.1.4', source });
  const installed = await installPlugin({
    id: 'offline-fixture', version: '3.1.4', channel: 'stable', repo: source.repo, ref: source.ref, commit, source,
    artifact: { kind: 'git-source', integrity }, integrity,
    runtime: { type: 'plugin' }, capabilities: ['plugin'], dependencies: [], permissions: [],
  }, { root: join(root, 'plugins'), repositoryUrl: repo });
  const lock = await readInstallLock(installed.target);
  const registryFile = join(root, 'registry', 'runtime.json');
  await writeRuntimeRegistry({ schema_version: 3, generation: 0, packages: [{
    type: 'plugin', id: 'offline-fixture', version: '3.1.4', state: 'active', enabled: true, activated: true,
    restart_required: false, path: installed.target, commit, source: lock.source, dependencies: [], history: [],
  }] }, registryFile);
  return { root, repo, commit, target: installed.target, registryFile, bundleFile: join(root, 'offline-fixture.dshpkg') };
}

describe('.dshpkg offline packages', () => {
  it('exports a clean locked Git tree and restores it offline with pending activation', async () => {
    const env = await setup();
    const exported = await exportOfflinePackage('plugin:offline-fixture', {
      registryFile: env.registryFile,
      output: env.bundleFile,
    });
    expect(exported.offline_safe).toBe(true);
    expect(exported.bundle_hash).toMatch(/^[0-9a-f]{64}$/);
    const parsed = await readOfflinePackage(env.bundleFile);
    expect(parsed.bundle.package.source.commit).toBe(env.commit);
    expect(parsed.bundle.entries.some((entry: any) => entry.path.startsWith('.git/'))).toBe(true);

    await rm(env.target, { recursive: true, force: true });
    const dryRun = await installOfflinePackage(env.bundleFile, { registryFile: env.registryFile, dryRun: true });
    expect(dryRun).toMatchObject({ dry_run: true, executed: false, auto_restart: false });
    await expect(installOfflinePackage(env.bundleFile, { registryFile: env.registryFile }))
      .rejects.toMatchObject({ code: 'DSH_OFFLINE_INSTALL_APPROVAL_REQUIRED' });

    const installed: any = await installOfflinePackage(env.bundleFile, {
      registryFile: env.registryFile,
      approved: true,
      storeRoot: join(env.root, 'store', 'sha256'),
    });
    expect(installed).toMatchObject({ executed: true, auto_restart: false, restart_required: true });
    expect(git(env.target, ['rev-parse', 'HEAD'])).toBe(env.commit);
    const runtime = await readRuntimeRegistry(env.registryFile);
    expect(getRuntimePackage(runtime, 'plugin', 'offline-fixture', { includeRemoved: true }))
      .toMatchObject({ state: 'pending-restart', activated: false, restart_required: true });
  }, 30_000);

  it('refuses to export a dirty installed Git worktree', async () => {
    const env = await setup();
    await writeFile(join(env.target, 'index.mjs'), 'export const compromised = true;\n');
    await expect(exportOfflinePackage('plugin:offline-fixture', { registryFile: env.registryFile, output: env.bundleFile }))
      .rejects.toMatchObject({ code: 'DSH_INTEGRITY_MISMATCH' });
  }, 20_000);

  it('rejects bundle tampering and path traversal even when the attacker recomputes the outer bundle hash', async () => {
    const env = await setup();
    await exportOfflinePackage('plugin:offline-fixture', { registryFile: env.registryFile, output: env.bundleFile });
    const bundle = JSON.parse(await readFile(env.bundleFile, 'utf8'));
    bundle.entries[0].path = '../escape';
    bundle.bundle_hash = offlineBundleHash(bundle);
    await writeFile(env.bundleFile, JSON.stringify(bundle));
    await expect(readOfflinePackage(env.bundleFile)).rejects.toMatchObject({ code: 'DSH_OFFLINE_PACKAGE_INVALID' });
  }, 20_000);
});
