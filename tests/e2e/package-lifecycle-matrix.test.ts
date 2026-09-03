import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const { artifactIntegrity } = await import('../../scripts/checksum.mjs');
const { searchPackages, packageInfo } = await import('../../runtime/discovery-cli.mjs');
const { preflightPackage } = await import('../../runtime/preflight.mjs');
const { installPackage } = await import('../../runtime/installer.mjs');
const { readInstallLock, verifyInstalledCommit } = await import('../../runtime/verifier.mjs');
const { activatePendingPackages } = await import('../../runtime/startup.mjs');
const { checkRuntimePackageHealth } = await import('../../runtime/health.mjs');
const { disablePackage, enablePackage } = await import('../../runtime/platform.mjs');
const { rollbackInstalledPath } = await import('../../runtime/rollback.mjs');
const {
  getRuntimePackage,
  markRuntimePackageRemoved,
  readRuntimeRegistry,
  removePath,
  upsertRuntimePackage,
  writeRuntimeRegistry,
} = await import('../../runtime/registry.mjs');

const types = ['plugin', 'mcp', 'skill', 'agent'] as const;
type PackageType = typeof types[number];

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await exec('git', args, { cwd, encoding: 'utf8' });
  return result.stdout.trim();
}

function makePackage(type: PackageType, version: string, commit: string) {
  const id = `lifecycle-${type}`;
  const source = { provider: 'github', repo: `owner/${id}`, ref: 'main', commit };
  return {
    id,
    type,
    version,
    channel: 'stable',
    repo: source.repo,
    ref: source.ref,
    commit,
    source,
    artifact: { kind: 'git-source', integrity: artifactIntegrity({ version, source }) },
    integrity: artifactIntegrity({ version, source }),
    runtime: { type, permissions: { network: false, filesystem: false, process: false } },
    capabilities: [type],
    dependencies: [],
    permissions: [],
    publisher: { id: 'owner' },
    security: {},
  };
}

function registry(packages: any[]) {
  return {
    registry_version: 3,
    schema_version: '3.0.0',
    defaults: { plugin_version: '1.0.0' },
    plugins: packages,
  };
}

async function persistPending(registryFile: string, pkg: any, path: string, previous: any = null) {
  const runtime = await readRuntimeRegistry(registryFile);
  const record = {
    ...(previous || getRuntimePackage(runtime, pkg.type, pkg.id, { includeRemoved: true }) || {}),
    id: pkg.id,
    type: pkg.type,
    version: pkg.version,
    state: 'pending-restart',
    channel: pkg.channel,
    enabled: true,
    activated: false,
    restart_required: true,
    path,
    source: pkg.source,
    commit: pkg.commit,
    runtime: pkg.runtime,
    capabilities: pkg.capabilities,
    dependencies: pkg.dependencies,
    permissions: pkg.permissions,
    publisher: pkg.publisher,
    security: pkg.security,
    binding: null,
    health: null,
  };
  await writeRuntimeRegistry(upsertRuntimePackage(runtime, record), registryFile);
}

describe('final acceptance: four-type package lifecycle matrix', () => {
  it('covers discovery through remove for plugin, MCP, skill, and agent', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'dsh-e2e-lifecycle-fixture-'));
    const root = await mkdtemp(join(tmpdir(), 'dsh-e2e-lifecycle-root-'));
    const registryFile = join(root, 'runtime.json');

    await git(fixture, ['init', '-q']);
    await git(fixture, ['config', 'user.email', 'acceptance@test.local']);
    await git(fixture, ['config', 'user.name', 'DSH Acceptance']);
    await writeFile(join(fixture, 'dsh-plugin.json'), JSON.stringify({ name: 'lifecycle-plugin' }));
    await writeFile(join(fixture, 'dsh-mcp.json'), JSON.stringify({ name: 'lifecycle-mcp' }));
    await writeFile(join(fixture, 'SKILL.md'), '# Lifecycle skill\n');
    await writeFile(join(fixture, 'dsh-agent.json'), JSON.stringify({ name: 'lifecycle-agent' }));
    await writeFile(join(fixture, 'VERSION'), '1.0.0\n');
    await git(fixture, ['add', '.']);
    await git(fixture, ['commit', '-m', 'lifecycle fixtures v1']);
    const v1Commit = await git(fixture, ['rev-parse', 'HEAD']);
    const v1Packages = types.map((type) => makePackage(type, '1.0.0', v1Commit));
    const sourceRegistry = registry(v1Packages);

    for (const pkg of v1Packages) {
      const search = searchPackages(sourceRegistry, pkg.id, { type: pkg.type });
      expect(search.packages).toHaveLength(1);
      expect(search.packages[0]).toMatchObject({ id: pkg.id, type: pkg.type, version: '1.0.0' });

      const info = packageInfo(sourceRegistry, pkg.type, pkg.id);
      expect(info).toMatchObject({ id: pkg.id, type: pkg.type, version: '1.0.0' });
      expect(info.install_command).toContain(`dsh ${pkg.type} install`);

      const preflight = preflightPackage(sourceRegistry, `${pkg.type}:${pkg.id}@1.0.0`, { type: pkg.type });
      expect(preflight.allowed).toBe(true);
      expect(preflight.type).toBe(pkg.type);

      const installed = await installPackage(pkg, {
        root: join(root, 'packages', pkg.type),
        repositoryUrl: fixture,
      });
      const lock = await readInstallLock(installed.target);
      expect(lock).toMatchObject({ id: pkg.id, type: pkg.type, version: '1.0.0' });
      await expect(verifyInstalledCommit(installed.target, v1Commit)).resolves.toBeUndefined();
      await persistPending(registryFile, pkg, installed.target);
    }

    let runtime = await readRuntimeRegistry(registryFile);
    expect(runtime.packages).toHaveLength(4);
    for (const type of types) {
      const record = getRuntimePackage(runtime, type, `lifecycle-${type}`);
      expect(record).toMatchObject({ type, state: 'pending-restart', restart_required: true });
    }

    const firstStartup = await activatePendingPackages({ registryFile });
    expect(firstStartup.healthy).toBe(true);
    expect(firstStartup.activated).toHaveLength(4);

    runtime = await readRuntimeRegistry(registryFile);
    for (const type of types) {
      const id = `lifecycle-${type}`;
      const record = getRuntimePackage(runtime, type, id);
      expect(record).toMatchObject({ id, type, state: 'active', activated: true, restart_required: false });
      const health = await checkRuntimePackageHealth(record, { runtimeRegistry: runtime });
      expect(['healthy', 'warning']).toContain(health.status);
      expect(health.failed).toEqual([]);
    }

    await writeFile(join(fixture, 'VERSION'), '2.0.0\n');
    await git(fixture, ['add', 'VERSION']);
    await git(fixture, ['commit', '-m', 'lifecycle fixtures v2']);
    const v2Commit = await git(fixture, ['rev-parse', 'HEAD']);
    const v2Packages = types.map((type) => makePackage(type, '2.0.0', v2Commit));

    for (const pkg of v2Packages) {
      const currentRuntime = await readRuntimeRegistry(registryFile);
      const current = getRuntimePackage(currentRuntime, pkg.type, pkg.id);
      expect(current?.version).toBe('1.0.0');

      const updated = await installPackage(pkg, {
        root: join(root, 'packages', pkg.type),
        repositoryUrl: fixture,
        force: true,
      });
      expect(updated.backup).toBeTruthy();
      expect((await readInstallLock(updated.target)).version).toBe('2.0.0');
      await persistPending(registryFile, pkg, updated.target, current);
    }

    runtime = await readRuntimeRegistry(registryFile);
    expect(runtime.packages.every((item: any) => item.version === '2.0.0' && item.state === 'pending-restart')).toBe(true);

    for (const type of types) {
      const id = `lifecycle-${type}`;
      const currentRuntime = await readRuntimeRegistry(registryFile);
      const current = getRuntimePackage(currentRuntime, type, id);
      const rolledBack = await rollbackInstalledPath(current.path);
      expect(rolledBack.lock.version).toBe('1.0.0');
      const restored = {
        ...current,
        version: rolledBack.lock.version,
        source: rolledBack.lock.source,
        commit: rolledBack.lock.source.commit,
        state: 'pending-restart',
        activated: false,
        restart_required: true,
        binding: null,
        health: null,
      };
      await writeRuntimeRegistry(upsertRuntimePackage(currentRuntime, restored), registryFile);
    }

    for (const type of types) {
      const id = `lifecycle-${type}`;
      let currentRuntime = await readRuntimeRegistry(registryFile);
      let record = getRuntimePackage(currentRuntime, type, id);
      const disabled = disablePackage(record);
      await writeRuntimeRegistry(upsertRuntimePackage(currentRuntime, disabled), registryFile);
      expect(disabled).toMatchObject({ state: 'disabled', enabled: false, activated: false, restart_required: true });

      currentRuntime = await readRuntimeRegistry(registryFile);
      record = getRuntimePackage(currentRuntime, type, id);
      const enabled = enablePackage(record);
      await writeRuntimeRegistry(upsertRuntimePackage(currentRuntime, enabled), registryFile);
      expect(enabled).toMatchObject({ state: 'pending-restart', enabled: true, activated: false, restart_required: true });
    }

    const secondStartup = await activatePendingPackages({ registryFile });
    expect(secondStartup.healthy).toBe(true);
    expect(secondStartup.activated).toHaveLength(4);

    runtime = await readRuntimeRegistry(registryFile);
    expect(runtime.packages.every((item: any) => item.version === '1.0.0' && item.state === 'active')).toBe(true);

    for (const type of types) {
      const id = `lifecycle-${type}`;
      const currentRuntime = await readRuntimeRegistry(registryFile);
      const record = getRuntimePackage(currentRuntime, type, id);
      await removePath(record.path);
      const removed = markRuntimePackageRemoved(currentRuntime, type, id, { path: record.path });
      await writeRuntimeRegistry(removed, registryFile);
    }

    runtime = await readRuntimeRegistry(registryFile);
    expect(runtime.packages).toHaveLength(4);
    for (const type of types) {
      const record = getRuntimePackage(runtime, type, `lifecycle-${type}`, { includeRemoved: true });
      expect(record).toMatchObject({ type, state: 'removed', enabled: false, activated: false, restart_required: true });
    }
  }, 60_000);
});
