import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const cli = join(process.cwd(), 'bin', 'dsh.mjs');

describe('offline package-manager inspection', () => {
  it('reads cached Registry V3 status without resolving a remote source', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-offline-cache-'));
    const cache = join(dir, 'registry-v3.json');
    const metadata = `${cache}.meta.json`;
    await writeFile(cache, JSON.stringify({
      registry_version: 3,
      schema_version: '3.0.0',
      generated: { content_hash: 'abc123', at: '2026-09-03T00:00:00.000Z' },
      plugins: [],
    }, null, 2));
    await writeFile(metadata, JSON.stringify({
      source: 'https://offline.invalid/registry-v3.json',
      mode: 'legacy-full-registry',
      content_hash: 'abc123',
      checked_at: '2026-09-03T00:01:00.000Z',
    }, null, 2));

    const { stdout } = await exec(process.execPath, [cli, '--json', 'cache', 'status'], {
      cwd: process.cwd(),
      env: { ...process.env, DSH_REGISTRY_CACHE: cache },
    });
    const payload = JSON.parse(stdout);
    expect(payload).toMatchObject({ schema_version: 1, ok: true, command: 'cache status' });
    expect(payload.data).toMatchObject({
      available: true,
      offline_safe: true,
      registry_version: 3,
      package_count: 0,
      content_hash: 'abc123',
      mode: 'legacy-full-registry',
    });
  });

  it('reads an installed package lock and authoritative activation state locally', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-offline-lock-'));
    const runtimeRegistry = join(dir, 'runtime.json');
    const target = join(dir, 'plugins', 'demo');
    await mkdir(target, { recursive: true });
    await writeFile(join(target, '.dsh-install.json'), JSON.stringify({
      id: 'demo',
      type: 'plugin',
      package_type: 'plugin',
      version: '1.0.0',
      channel: 'stable',
      source: {
        provider: 'github',
        repo: 'owner/demo',
        ref: 'main',
        commit: '0123456789012345678901234567890123456789',
      },
    }, null, 2));
    await writeFile(runtimeRegistry, JSON.stringify({
      schema_version: 3,
      generation: 0,
      packages: [{
        id: 'demo', type: 'plugin', version: '1.0.0', state: 'pending-restart',
        channel: 'stable', enabled: true, activated: false, restart_required: true,
        path: target, commit: '0123456789012345678901234567890123456789', history: [],
      }],
    }, null, 2));

    const { stdout } = await exec(process.execPath, [
      cli, '--json', 'package', 'lock', 'plugin:demo', '--runtime-registry', runtimeRegistry,
    ], { cwd: process.cwd(), env: { ...process.env } });
    const payload = JSON.parse(stdout);
    expect(payload).toMatchObject({ schema_version: 1, ok: true, command: 'package lock plugin:demo' });
    expect(payload.data).toMatchObject({
      id: 'demo', type: 'plugin', key: 'plugin:demo', activation_state: 'pending-restart', offline_safe: true,
      lock: { id: 'demo', type: 'plugin', version: '1.0.0' },
    });
  });
});
