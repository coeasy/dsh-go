import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Runtime Platform V2 CLI', () => {
  it('supports status, disable, enable, and history through persisted registry state', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-cli-'));
    const registry = join(dir, 'runtime.json');
    await writeFile(registry, JSON.stringify({
      schema_version: 2,
      generation: 0,
      plugins: [{
        id: 'demo', type: 'plugin', version: '0.1.0', state: 'installed', channel: 'stable', enabled: true,
        activated: false, restart_required: true, commit: 'abc', dependencies: [], history: [],
      }],
    }));
    const env = { ...process.env, DSH_REGISTRY: registry };
    const run = (args: string[]) => execFileSync('node', args, { env, encoding: 'utf8' });

    expect(JSON.parse(run(['runtime/cli.mjs', 'plugin', 'status', 'demo'])).id).toBe('demo');

    run(['runtime/cli.mjs', 'plugin', 'disable', 'demo']);
    let stored = JSON.parse(await readFile(registry, 'utf8'));
    expect(stored.plugins[0].state).toBe('disabled');
    expect(stored.plugins[0].restart_required).toBe(true);

    run(['runtime/cli.mjs', 'plugin', 'enable', 'demo']);
    stored = JSON.parse(await readFile(registry, 'utf8'));
    expect(stored.plugins[0].state).toBe('installed');
    expect(stored.plugins[0].enabled).toBe(true);

    expect(JSON.parse(run(['runtime/cli.mjs', 'plugin', 'history', 'demo'])).history.length).toBeGreaterThanOrEqual(2);
  });
});
