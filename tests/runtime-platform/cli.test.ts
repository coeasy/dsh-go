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

    const initial = JSON.parse(run(['runtime/cli.mjs', 'plugin', 'status', 'demo']));
    expect(initial.id).toBe('demo');
    expect(initial.activation_state).toBe('pending-restart');

    run(['runtime/cli.mjs', 'plugin', 'disable', 'demo']);
    let stored = JSON.parse(await readFile(registry, 'utf8'));
    expect(stored.plugins[0].state).toBe('disabled');
    expect(stored.plugins[0].restart_required).toBe(true);

    const enabled = JSON.parse(run(['runtime/cli.mjs', 'plugin', 'enable', 'demo']));
    stored = JSON.parse(await readFile(registry, 'utf8'));
    expect(stored.plugins[0].state).toBe('pending-restart');
    expect(stored.plugins[0].enabled).toBe(true);
    expect(enabled.activation_state).toBe('pending-restart');

    expect(JSON.parse(run(['runtime/cli.mjs', 'plugin', 'history', 'demo'])).history.length).toBeGreaterThanOrEqual(2);
  });
});
