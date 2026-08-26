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

const types = ['plugin', 'mcp', 'skill', 'agent'] as const;

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await exec('git', args, { cwd, encoding: 'utf8' });
  return result.stdout.trim();
}

function resolved(type: typeof types[number], id: string, commit: string) {
  const source = { provider: 'github', repo: `owner/${type}-${id}`, ref: 'main', commit };
  const version = '1.0.0';
  return {
    id,
    type,
    version,
    channel: 'stable',
    repo: source.repo,
    ref: source.ref,
    commit,
    source,
    artifact: { integrity: artifactIntegrity({ version, source }) },
    integrity: artifactIntegrity({ version, source }),
    runtime: { type, permissions: { network: false, filesystem: false, process: false } },
    capabilities: [type],
    dependencies: [],
  };
}

describe('Runtime Platform V3 unified local E2E', () => {
  it('installs, verifies, binds, and activates all package types without type collisions', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'dsh-v3-fixture-'));
    const root = await mkdtemp(join(tmpdir(), 'dsh-v3-root-'));
    const registryFile = join(root, 'runtime.json');
    await git(fixture, ['init', '-q']);
    await git(fixture, ['config', 'user.email', 'runtime@test.local']);
    await git(fixture, ['config', 'user.name', 'Runtime V3 Test']);
    await writeFile(join(fixture, 'dsh-plugin.json'), JSON.stringify({ name: 'shared' }));
    await writeFile(join(fixture, 'dsh-mcp.json'), JSON.stringify({ name: 'shared-mcp' }));
    await writeFile(join(fixture, 'SKILL.md'), '# Shared skill\n');
    await writeFile(join(fixture, 'dsh-agent.json'), JSON.stringify({ name: 'shared-agent' }));
    await git(fixture, ['add', '.']);
    await git(fixture, ['commit', '-m', 'unified package fixture']);
    const commit = await git(fixture, ['rev-parse', 'HEAD']);

    const records: any[] = [];
    const roots = new Map<string, string>();
    for (const type of types) {
      const typeRoot = join(root, type);
      roots.set(type, typeRoot);
      const pkg = resolved(type, 'shared', commit);
      const installed = await installPackage(pkg, { root: typeRoot, repositoryUrl: fixture });
      const lock = JSON.parse(await readFile(join(installed.target, '.dsh-install.json'), 'utf8'));
      expect(lock.runtime_registry_version).toBe(3);
      expect(lock.type).toBe(type);
      records.push({
        id: pkg.id,
        type,
        version: pkg.version,
        state: 'installed',
        channel: 'stable',
        enabled: true,
        activated: false,
        restart_required: true,
        path: installed.target,
        source: pkg.source,
        commit,
        runtime: pkg.runtime,
        capabilities: pkg.capabilities,
        dependencies: [],
      });
    }

    await writeRuntimeRegistry({ schema_version: 3, generation: 0, packages: records }, registryFile);
    const startup = await activatePendingPackages({ registryFile });
    expect(startup.healthy).toBe(true);
    expect(startup.activated.map((item: any) => item.key).sort()).toEqual([
      'agent:shared', 'mcp:shared', 'plugin:shared', 'skill:shared',
    ]);

    const registry = await readRuntimeRegistry(registryFile);
    expect(registry.packages).toHaveLength(4);
    expect(registry.plugins).toHaveLength(1);
    for (const type of types) {
      const record = registry.packages.find((item: any) => item.type === type);
      expect(record?.state).toBe('active');
      expect(record?.restart_required).toBe(false);
      expect(record?.binding?.type).toBe(type);
      const loaded = await loadInstalledPackage(type, 'shared', { registryFile });
      expect(loaded.binding.kind).toBe(type);
      expect(loaded.binding.transport).toBe('local');
      expect(loaded.binding.permissions).toEqual({ network: false, filesystem: false, process: false });
      expect(loaded.target.startsWith(roots.get(type)!)).toBe(true);
    }
  }, 20_000);

  it('isolates a broken package during startup activation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-v3-failure-'));
    const registryFile = join(root, 'runtime.json');
    await writeRuntimeRegistry({
      schema_version: 3,
      generation: 0,
      packages: [
        { id: 'missing', type: 'mcp', version: '1.0.0', state: 'installed', enabled: true, activated: false, restart_required: true, path: join(root, 'missing'), commit: '0123456789abcdef0123456789abcdef01234567' },
        { id: 'disabled', type: 'skill', version: '1.0.0', state: 'disabled', enabled: false, activated: false, restart_required: true, path: join(root, 'disabled'), commit: '0123456789abcdef0123456789abcdef01234567' },
      ],
    }, registryFile);
    const startup = await activatePendingPackages({ registryFile });
    expect(startup.pending).toBe(1);
    expect(startup.failed).toHaveLength(1);
    expect(startup.failed[0].key).toBe('mcp:missing');
    const registry = await readRuntimeRegistry(registryFile);
    expect(registry.packages.find((item: any) => item.type === 'mcp')?.state).toBe('failed');
    expect(registry.packages.find((item: any) => item.type === 'skill')?.state).toBe('disabled');
  });
});
