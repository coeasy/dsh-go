import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildInstallDeepLink, deepLinkInstallPlan, parseDshUrl } from '../runtime/client-bridge.mjs';
import { startClientHost } from '../runtime/client-host.mjs';
import { writeRuntimeRegistry } from '../runtime/registry.mjs';

let previousHome: string | undefined;
let previousRegistry: string | undefined;
let root: string;
let registryFile: string;

beforeEach(async () => {
  previousHome = process.env.DSH_RUNTIME_HOME;
  previousRegistry = process.env.DSH_REGISTRY;
  root = await mkdtemp(join(tmpdir(), 'dsh-package-request-bridge-'));
  registryFile = join(root, 'runtime.json');
  process.env.DSH_RUNTIME_HOME = root;
  process.env.DSH_REGISTRY = registryFile;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.DSH_RUNTIME_HOME; else process.env.DSH_RUNTIME_HOME = previousHome;
  if (previousRegistry === undefined) delete process.env.DSH_REGISTRY; else process.env.DSH_REGISTRY = previousRegistry;
});

describe('shared PackageRequest bridge contract', () => {
  it('round-trips typed repository ids, ranges, channels and registry selectors', () => {
    const url = buildInstallDeepLink({
      id: 'owner/example-plugin',
      type: 'plugin',
      versionRange: '^1.2.0',
      channel: 'beta',
      registry: 'community',
    });
    const parsed = parseDshUrl(url);
    expect(parsed).toMatchObject({
      action: 'install',
      id: 'owner/example-plugin',
      type: 'plugin',
      versionRange: '^1.2.0',
      channel: 'beta',
      registry: 'community',
    });
    const plan = deepLinkInstallPlan(url);
    expect(plan.argv).toEqual([
      'plugin', 'install', 'owner/example-plugin@^1.2.0',
      '--channel', 'beta', '--registry', 'community',
    ]);
    expect(plan.confirmation_required).toBe(true);
    expect(plan.auto_restart).toBe(false);
  });

  it('keeps the legacy plugin query readable while normalizing it to PackageRequest', () => {
    expect(parseDshUrl('dsh://install?plugin=owner/legacy-plugin')).toMatchObject({
      id: 'owner/legacy-plugin',
      type: 'plugin',
      versionRange: '*',
      channel: 'stable',
    });
  });

  it('returns authoritative activation_state from the local client host', async () => {
    await writeRuntimeRegistry({
      schema_version: 3,
      generation: 0,
      packages: [
        { type: 'plugin', id: 'pending', version: '1.0.0', state: 'pending-restart', enabled: true, activated: false, restart_required: true },
        { type: 'mcp', id: 'active', version: '2.0.0', state: 'active', enabled: true, activated: true, restart_required: false },
      ],
    }, registryFile);
    const token = 'b'.repeat(64);
    const headers = { Authorization: `Bearer ${token}` };
    const host = await startClientHost({ port: 0, token });
    try {
      const base = `http://${host.host}:${host.port}`;
      const list = await fetch(`${base}/v1/packages`, { headers });
      const body: any = await list.json();
      expect(body.packages.find((item: any) => item.id === 'pending').activation_state).toBe('pending-restart');
      expect(body.packages.find((item: any) => item.id === 'active').activation_state).toBe('active');

      const one = await fetch(`${base}/v1/packages/plugin/pending`, { headers });
      expect((await one.json() as any).package.activation_state).toBe('pending-restart');
    } finally {
      await new Promise<void>((accept, reject) => host.server.close((error) => error ? reject(error) : accept()));
    }
  }, 20_000);
});
