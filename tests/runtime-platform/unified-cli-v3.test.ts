import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const { artifactIntegrity } = await import('../../scripts/checksum.mjs');

function run(args: string[], env: NodeJS.ProcessEnv) {
  return execFileSync(process.execPath, ['runtime/cli.mjs', ...args], { cwd: process.cwd(), env, encoding: 'utf8' });
}

describe('Runtime Platform V3 unified CLI', () => {
  it('plans typed installs without mutating the local registry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-v3-cli-'));
    const catalog = join(dir, 'registry-v3.json');
    const runtimeRegistry = join(dir, 'runtime.json');
    const commit = '0123456789abcdef0123456789abcdef01234567';
    const source = { provider: 'github', repo: 'owner/server', ref: 'main', commit };
    const version = '1.0.0';
    await writeFile(catalog, JSON.stringify({
      registry_version: 3,
      defaults: { plugin_version: '0.1.0' },
      plugins: [{
        id: 'server', version, channel: 'stable', source,
        artifact: { integrity: artifactIntegrity({ version, source }) },
        runtime: { type: 'mcp' }, capabilities: ['mcp'], dependencies: [],
      }],
    }));
    const env = { ...process.env, DSH_REGISTRY: runtimeRegistry };
    const result = JSON.parse(run(['mcp', 'install', 'server@1.0.0', '--registry', catalog, '--dry-run', '--root', join(dir, 'mcp')], env));
    expect(result.type).toBe('mcp');
    expect(result.restart_required).toBe(false);
    expect(result.dependency_order).toEqual(['mcp:server']);
    expect(result.results[0]).toMatchObject({ type: 'mcp', id: 'server', version: '1.0.0' });
  });

  it('lists schema-3 packages by type while keeping plugin commands compatible', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-v3-list-'));
    const runtimeRegistry = join(dir, 'runtime.json');
    await writeFile(runtimeRegistry, JSON.stringify({
      schema_version: 3,
      generation: 1,
      packages: [
        { id: 'same', type: 'plugin', version: '1.0.0', state: 'installed', commit: 'abc' },
        { id: 'same', type: 'mcp', version: '2.0.0', state: 'installed', commit: 'def' },
      ],
    }));
    const env = { ...process.env, DSH_REGISTRY: runtimeRegistry };
    const mcp = JSON.parse(run(['mcp', 'list'], env));
    const plugins = JSON.parse(run(['plugin', 'list'], env));
    const all = JSON.parse(run(['package', 'list'], env));
    expect(mcp).toHaveLength(1);
    expect(mcp[0].type).toBe('mcp');
    expect(plugins).toHaveLength(1);
    expect(plugins[0].type).toBe('plugin');
    expect(all).toHaveLength(2);
  });
});
