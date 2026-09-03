import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const { artifactIntegrity } = await import('../../scripts/checksum.mjs');
const { installPackage } = await import('../../runtime/installer.mjs');
const { activatePendingPackages } = await import('../../runtime/startup.mjs');
const { readRuntimeRegistry, writeRuntimeRegistry } = await import('../../runtime/registry.mjs');

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await exec('git', args, { cwd, encoding: 'utf8' });
  return result.stdout.trim();
}

describe('final acceptance: fault isolation and recovery', () => {
  it('activates healthy packages while failing a broken package closed', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'dsh-e2e-fault-fixture-'));
    const root = await mkdtemp(join(tmpdir(), 'dsh-e2e-fault-root-'));
    const registryFile = join(root, 'runtime.json');

    await git(fixture, ['init', '-q']);
    await git(fixture, ['config', 'user.email', 'acceptance@test.local']);
    await git(fixture, ['config', 'user.name', 'DSH Acceptance']);
    await writeFile(join(fixture, 'dsh-plugin.json'), JSON.stringify({ name: 'healthy-plugin' }));
    await git(fixture, ['add', '.']);
    await git(fixture, ['commit', '-m', 'healthy fixture']);
    const commit = await git(fixture, ['rev-parse', 'HEAD']);

    const version = '1.0.0';
    const source = { provider: 'github', repo: 'owner/healthy-plugin', ref: 'main', commit };
    const integrity = artifactIntegrity({ version, source });
    const healthy = {
      id: 'healthy-plugin',
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

    const installed = await installPackage(healthy, {
      root: join(root, 'plugins'),
      repositoryUrl: fixture,
    });

    await writeRuntimeRegistry({
      schema_version: 3,
      generation: 0,
      packages: [
        {
          id: healthy.id,
          type: healthy.type,
          version: healthy.version,
          state: 'pending-restart',
          enabled: true,
          activated: false,
          restart_required: true,
          path: installed.target,
          source,
          commit,
          runtime: healthy.runtime,
          capabilities: healthy.capabilities,
          dependencies: [],
        },
        {
          id: 'missing-mcp',
          type: 'mcp',
          version: '1.0.0',
          state: 'pending-restart',
          enabled: true,
          activated: false,
          restart_required: true,
          path: join(root, 'missing-mcp'),
          commit: '0123456789abcdef0123456789abcdef01234567',
          runtime: { type: 'mcp' },
          capabilities: ['mcp'],
          dependencies: [],
        },
      ],
    }, registryFile);

    const startup = await activatePendingPackages({ registryFile });
    expect(startup.healthy).toBe(false);
    expect(startup.activated.map((item: any) => item.key)).toContain('plugin:healthy-plugin');
    expect(startup.failed.map((item: any) => item.key)).toContain('mcp:missing-mcp');

    const registry = await readRuntimeRegistry(registryFile);
    const healthyRecord = registry.packages.find((item: any) => item.id === 'healthy-plugin');
    const failedRecord = registry.packages.find((item: any) => item.id === 'missing-mcp');
    expect(healthyRecord?.state).toBe('active');
    expect(healthyRecord?.restart_required).toBe(false);
    expect(failedRecord?.state).toBe('failed');
    expect(failedRecord?.activated).toBe(false);
  }, 20_000);
});
