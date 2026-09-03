import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
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

type PackageType = typeof types[number];

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await exec('git', args, { cwd, encoding: 'utf8' });
  return result.stdout.trim();
}

function makePackage(type: PackageType, commit: string) {
  const version = '1.0.0';
  const source = { provider: 'github', repo: `owner/acceptance-${type}`, ref: 'main', commit };
  const integrity = artifactIntegrity({ version, source });
  return {
    id: `acceptance-${type}`,
    type,
    version,
    channel: 'stable',
    repo: source.repo,
    ref: source.ref,
    commit,
    source,
    artifact: { integrity },
    integrity,
    runtime: { type, permissions: { network: false, filesystem: false, process: false } },
    capabilities: [type],
    dependencies: [],
  };
}

describe('final acceptance: unified ecosystem flow', () => {
  it('installs and activates plugin, MCP, skill, and agent through one runtime contract', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'dsh-e2e-ecosystem-fixture-'));
    const root = await mkdtemp(join(tmpdir(), 'dsh-e2e-ecosystem-root-'));
    const registryFile = join(root, 'runtime.json');

    await git(fixture, ['init', '-q']);
    await git(fixture, ['config', 'user.email', 'acceptance@test.local']);
    await git(fixture, ['config', 'user.name', 'DSH Acceptance']);
    await writeFile(join(fixture, 'dsh-plugin.json'), JSON.stringify({ name: 'acceptance-plugin' }));
    await writeFile(join(fixture, 'dsh-mcp.json'), JSON.stringify({ name: 'acceptance-mcp' }));
    await writeFile(join(fixture, 'SKILL.md'), '# Acceptance skill\n');
    await writeFile(join(fixture, 'dsh-agent.json'), JSON.stringify({ name: 'acceptance-agent' }));
    await git(fixture, ['add', '.']);
    await git(fixture, ['commit', '-m', 'acceptance ecosystem fixture']);
    const commit = await git(fixture, ['rev-parse', 'HEAD']);

    const records: any[] = [];
    for (const type of types) {
      const pkg = makePackage(type, commit);
      const installed = await installPackage(pkg, {
        root: join(root, type),
        repositoryUrl: fixture,
      });
      records.push({
        id: pkg.id,
        type,
        version: pkg.version,
        state: 'pending-restart',
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
      'agent:acceptance-agent',
      'mcp:acceptance-mcp',
      'plugin:acceptance-plugin',
      'skill:acceptance-skill',
    ]);

    const registry = await readRuntimeRegistry(registryFile);
    expect(registry.packages).toHaveLength(4);
    for (const type of types) {
      const id = `acceptance-${type}`;
      const record = registry.packages.find((item: any) => item.type === type && item.id === id);
      expect(record?.state).toBe('active');
      expect(record?.activated).toBe(true);
      expect(record?.restart_required).toBe(false);
      const loaded = await loadInstalledPackage(type, id, { registryFile });
      expect(loaded.binding.kind).toBe(type);
      expect(loaded.binding.transport).toBe('local');
    }
  }, 30_000);
});
