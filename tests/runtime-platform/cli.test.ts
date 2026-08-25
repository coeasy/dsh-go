import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);

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

    const status = await exec('node', ['runtime/cli.mjs', 'plugin', 'status', 'demo'], { env });
    expect(JSON.parse(status.stdout).id).toBe('demo');

    await exec('node', ['runtime/cli.mjs', 'plugin', 'disable', 'demo'], { env });
    let stored = JSON.parse(await readFile(registry, 'utf8'));
    expect(stored.plugins[0].state).toBe('disabled');
    expect(stored.plugins[0].restart_required).toBe(true);

    await exec('node', ['runtime/cli.mjs', 'plugin', 'enable', 'demo'], { env });
    stored = JSON.parse(await readFile(registry, 'utf8'));
    expect(stored.plugins[0].state).toBe('installed');
    expect(stored.plugins[0].enabled).toBe(true);

    const history = await exec('node', ['runtime/cli.mjs', 'plugin', 'history', 'demo'], { env });
    expect(JSON.parse(history.stdout).history.length).toBeGreaterThanOrEqual(2);
  });
});
