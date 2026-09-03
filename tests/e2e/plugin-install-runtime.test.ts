import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const { artifactIntegrity } = await import('../../scripts/checksum.mjs');
const { installPackage } = await import('../../runtime/installer.mjs');
const { loadInstalledPackage } = await import('../../runtime/loader.mjs');
const { activatePendingPackages } = await import('../../runtime/startup.mjs');
const { readRuntimeRegistry, writeRuntimeRegistry } = await import('../../runtime/registry.mjs');

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await exec('git', args, { cwd, encoding: 'utf8' });
  return result.stdout.trim();
}

describe('final acceptance: plugin install runtime flow', () => {
  it('installs a real local plugin, persists its lock, then activates it after restart', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'dsh-e2e-plugin-fixture-'));
    const root = await mkdtemp(join(tmpdir(), 'dsh-e2e-plugin-root-'));
    const installRoot = join(root, 'plugins');
    const registryFile = join(root, 'runtime.json');

    await git(fixture, ['init', '-q']);
    await git(fixture, ['config', 'user.email', 'acceptance@test.local']);
    await git(fixture, ['config', 'user.name', 'DSH Acceptance']);
    await writeFile(join(fixture, 'dsh-plugin.json'), JSON.stringify({ name: 'acceptance-plugin' }));
    await git(fixture, ['add', '.']);
    await git(fixture, ['commit', '-m', 'acceptance plugin fixture']);
    const commit = await git(fixture, ['rev-parse', 'HEAD']);

    const version = '1.0.0';
    const source = { provider: 'github', repo: 'owner/acceptance-plugin', ref: 'main', commit };
    const integrity = artifactIntegrity({ version, source });
    const pkg = {
      id: 'acceptance-plugin',
      type: 'plugin',
      version,
      channel: 'stable',
      repo: source.repo,
      ref: source.ref,
      commit,
      source,
      artifact: { integrity },
      integrity,
      runtime: { type: 'plugin', permissions: { network: false, filesystem: false, process: false } },
      capabilities: ['plugin'],
      dependencies: [],
    };

    const installed = await installPackage(pkg, { root: installRoot, repositoryUrl: fixture });
    const lock = JSON.parse(await readFile(join(installed.target, '.dsh-install.json'), 'utf8'));
    expect(lock.type).toBe('plugin');
    expect(lock.version).toBe(version);
    expect(lock.commit).toBe(commit);

    await writeRuntimeRegistry({
      schema_version: 3,
      generation: 0,
      packages: [{
        id: pkg.id,
        type: pkg.type,
        version: pkg.version,
        state: 'pending-restart',
        channel: 'stable',
        enabled: true,
        activated: false,
        restart_required: true,
        path: installed.target,
        source,
        commit,
        runtime: pkg.runtime,
        capabilities: pkg.capabilities,
        dependencies: [],
      }],
    }, registryFile);

    const before = await readRuntimeRegistry(registryFile);
    expect(before.packages[0].state).toBe('pending-restart');
    expect(before.packages[0].restart_required).toBe(true);

    const startup = await activatePendingPackages({ registryFile });
    expect(startup.healthy).toBe(true);
    expect(startup.activated.map((item: any) => item.key)).toEqual(['plugin:acceptance-plugin']);

    const after = await readRuntimeRegistry(registryFile);
    expect(after.packages[0].state).toBe('active');
    expect(after.packages[0].activated).toBe(true);
    expect(after.packages[0].restart_required).toBe(false);

    const loaded = await loadInstalledPackage('plugin', 'acceptance-plugin', { registryFile });
    expect(loaded.binding.kind).toBe('plugin');
    expect(loaded.binding.transport).toBe('local');
  }, 20_000);
});
