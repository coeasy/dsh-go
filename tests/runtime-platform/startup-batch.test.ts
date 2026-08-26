import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const { artifactIntegrity } = await import('../../scripts/checksum.mjs');
const { installPlugin } = await import('../../runtime/installer.mjs');
const { activatePendingPlugins } = await import('../../runtime/startup.mjs');
const { readRuntimeRegistry, writeRuntimeRegistry } = await import('../../runtime/registry.mjs');

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await exec('git', args, { cwd, encoding: 'utf8' });
  return result.stdout.trim();
}

async function makeFixture(name: string) {
  const fixture = await mkdtemp(join(tmpdir(), `dsh-${name}-fixture-`));
  await git(fixture, ['init', '-q']);
  await git(fixture, ['config', 'user.email', 'runtime@test.local']);
  await git(fixture, ['config', 'user.name', 'Runtime Test']);
  await writeFile(join(fixture, 'package.json'), JSON.stringify({ name, version: '0.1.0' }));
  await git(fixture, ['add', 'package.json']);
  await git(fixture, ['commit', '-m', 'fixture']);
  const commit = await git(fixture, ['rev-parse', 'HEAD']);
  const source = { provider: 'github', repo: `owner/${name}`, ref: 'main', commit };
  return {
    fixture,
    plugin: {
      id: name,
      version: '0.1.0',
      channel: 'stable',
      repo: source.repo,
      ref: source.ref,
      commit,
      source,
      artifact: { integrity: artifactIntegrity({ version: '0.1.0', source }) },
      integrity: artifactIntegrity({ version: '0.1.0', source }),
      runtime: { type: 'plugin' },
      capabilities: ['plugin'],
      dependencies: [],
    },
  };
}

describe('Phase 7 startup activation bridge', () => {
  it('activates every pending plugin after an explicit client restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-startup-root-'));
    const registryFile = join(root, 'runtime.json');
    const one = await makeFixture('phase7-one');
    const two = await makeFixture('phase7-two');
    const installedOne = await installPlugin(one.plugin, { root, repositoryUrl: one.fixture });
    const installedTwo = await installPlugin(two.plugin, { root, repositoryUrl: two.fixture });

    await writeRuntimeRegistry({
      schema_version: 2,
      generation: 0,
      plugins: [
        {
          id: one.plugin.id,
          type: 'plugin',
          version: one.plugin.version,
          state: 'installed',
          channel: 'stable',
          enabled: true,
          activated: false,
          restart_required: true,
          path: installedOne.target,
          source: one.plugin.source,
          commit: one.plugin.commit,
          dependencies: [],
        },
        {
          id: two.plugin.id,
          type: 'plugin',
          version: two.plugin.version,
          state: 'installed',
          channel: 'stable',
          enabled: true,
          activated: false,
          restart_required: true,
          path: installedTwo.target,
          source: two.plugin.source,
          commit: two.plugin.commit,
          dependencies: [],
        },
      ],
    }, registryFile);

    const result = await activatePendingPlugins({ registryFile });
    expect(result.healthy).toBe(true);
    expect(result.pending).toBe(2);
    expect(result.activated.map((item: { id: string }) => item.id).sort()).toEqual(['phase7-one', 'phase7-two']);
    expect(result.restart_required).toBe(false);

    const registry = await readRuntimeRegistry(registryFile);
    expect(registry.plugins.every((item: { state: string }) => item.state === 'active')).toBe(true);
    expect(registry.plugins.every((item: { activated: boolean }) => item.activated === true)).toBe(true);
    expect(registry.plugins.every((item: { restart_required: boolean }) => item.restart_required === false)).toBe(true);

    const second = await activatePendingPlugins({ registryFile });
    expect(second.pending).toBe(0);
    expect(second.activated).toEqual([]);
  }, 15_000);

  it('records a startup activation failure without auto-restarting the client', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-startup-failure-root-'));
    const registryFile = join(root, 'runtime.json');
    await writeRuntimeRegistry({
      schema_version: 2,
      generation: 0,
      plugins: [{
        id: 'missing-plugin',
        type: 'plugin',
        version: '0.1.0',
        state: 'installed',
        channel: 'stable',
        enabled: true,
        activated: false,
        restart_required: true,
        path: join(root, 'missing-plugin'),
        source: { provider: 'github', repo: 'owner/missing-plugin', ref: 'main', commit: '0123456789012345678901234567890123456789' },
        commit: '0123456789012345678901234567890123456789',
        dependencies: [],
      }],
    }, registryFile);

    const result = await activatePendingPlugins({ registryFile });
    expect(result.healthy).toBe(false);
    expect(result.failed).toHaveLength(1);
    expect(result.restart_required).toBe(true);

    const registry = await readRuntimeRegistry(registryFile);
    expect(registry.plugins[0].state).toBe('failed');
    expect(registry.plugins[0].restart_required).toBe(true);
    expect(registry.plugins[0].health.phase).toBe('startup-activation');
  });
});
