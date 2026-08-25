import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const { artifactIntegrity } = await import('../../scripts/checksum.mjs');
const { installPlugin } = await import('../../runtime/installer.mjs');
const { loadInstalledPlugin } = await import('../../runtime/loader.mjs');
const { readRuntimeRegistry, writeRuntimeRegistry } = await import('../../runtime/registry.mjs');

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await exec('git', args, { cwd, encoding: 'utf8' });
  return result.stdout.trim();
}

describe('Runtime Platform startup activation', () => {
  it('persists active state only when the client loader verifies the installed source', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'dsh-activation-fixture-'));
    const root = await mkdtemp(join(tmpdir(), 'dsh-activation-root-'));
    const registryFile = join(root, 'runtime.json');
    await git(fixture, ['init', '-q']);
    await git(fixture, ['config', 'user.email', 'runtime@test.local']);
    await git(fixture, ['config', 'user.name', 'Runtime Test']);
    await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: 'fixture-plugin', version: '0.1.0' }));
    await git(fixture, ['add', 'package.json']);
    await git(fixture, ['commit', '-m', 'fixture']);
    const commit = await git(fixture, ['rev-parse', 'HEAD']);
    const source = { provider: 'github', repo: 'owner/fixture-plugin', ref: 'main', commit };
    const plugin = {
      id: 'fixture-plugin',
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
    };
    const installed = await installPlugin(plugin, { root, repositoryUrl: fixture });
    await writeRuntimeRegistry({
      schema_version: 2,
      generation: 0,
      plugins: [{
        id: plugin.id,
        type: 'plugin',
        version: plugin.version,
        state: 'installed',
        channel: 'stable',
        enabled: true,
        activated: false,
        restart_required: true,
        path: installed.target,
        source,
        commit,
        dependencies: [],
      }],
    }, registryFile);

    const loaded = await loadInstalledPlugin(plugin.id, { root, version: plugin.version, registryFile });
    expect(loaded.activation).toBe('active');
    expect(loaded.restart_required).toBe(false);
    const registry = await readRuntimeRegistry(registryFile);
    expect(registry.plugins[0].state).toBe('active');
    expect(registry.plugins[0].activated).toBe(true);
    expect(registry.plugins[0].restart_required).toBe(false);
  });
});
