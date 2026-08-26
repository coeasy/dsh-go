import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startClientHost } from '../../runtime/client-host.mjs';
import { writeRuntimeRegistry } from '../../runtime/registry.mjs';

let previousHome: string | undefined;
let previousRegistry: string | undefined;
let root: string;
let registryFile: string;

beforeEach(async () => {
  previousHome = process.env.DSH_RUNTIME_HOME;
  previousRegistry = process.env.DSH_REGISTRY;
  root = await mkdtemp(join(tmpdir(), 'dsh-completion-host-'));
  registryFile = join(root, 'runtime.json');
  process.env.DSH_RUNTIME_HOME = root;
  process.env.DSH_REGISTRY = registryFile;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.DSH_RUNTIME_HOME; else process.env.DSH_RUNTIME_HOME = previousHome;
  if (previousRegistry === undefined) delete process.env.DSH_REGISTRY; else process.env.DSH_REGISTRY = previousRegistry;
});

describe('authenticated local control API v1', () => {
  it('supports typed package, config and secret CRUD without exposing secret values', async () => {
    await writeRuntimeRegistry({
      schema_version: 3,
      generation: 0,
      packages: [
        { type: 'plugin', id: 'same', version: '0.1.0', state: 'active', enabled: true, activated: true, restart_required: false },
        { type: 'mcp', id: 'same', version: '0.1.0', state: 'active', enabled: true, activated: true, restart_required: false },
      ],
    }, registryFile);
    const token = 'a'.repeat(64);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const host = await startClientHost({ port: 0, token });
    try {
      const base = `http://${host.host}:${host.port}`;
      const health = await fetch(`${base}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({ version: '0.1.0', api: '/v1' });

      const unauthorized = await fetch(`${base}/v1/packages`);
      expect(unauthorized.status).toBe(401);

      const response = await fetch(`${base}/v1/packages?type=mcp`, { headers });
      expect(response.status).toBe(200);
      expect(response.headers.get('x-dsh-api-version')).toBe('v1');
      const body: any = await response.json();
      expect(body.packages).toHaveLength(1);
      expect(body.packages[0]).toMatchObject({ type: 'mcp', id: 'same', version: '0.1.0' });

      const configSet = await fetch(`${base}/v1/packages/mcp/same/config`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ approved: true, key: 'mcp.args', value: ['serve', '--stdio'] }),
      });
      expect(configSet.status).toBe(200);
      expect((await configSet.json() as any).config.mcp.args).toEqual(['serve', '--stdio']);
      const configGet = await fetch(`${base}/v1/packages/mcp/same/config`, { headers });
      expect((await configGet.json() as any).config.mcp.args).toEqual(['serve', '--stdio']);

      const secretSet = await fetch(`${base}/v1/secrets/github.token`, {
        method: 'PUT', headers,
        body: JSON.stringify({ approved: true, value: 'do-not-return-me' }),
      });
      expect(secretSet.status).toBe(200);
      const secretSetBody: any = await secretSet.json();
      expect(secretSetBody.value).toBe('<secret>');
      expect(JSON.stringify(secretSetBody)).not.toContain('do-not-return-me');

      const secretList = await fetch(`${base}/v1/secrets`, { headers });
      expect(await secretList.json()).toEqual({ secrets: ['github.token'] });
      const secretRead = await fetch(`${base}/v1/secrets/github.token`, { headers });
      expect(secretRead.status).toBe(405);
      expect(JSON.stringify(await secretRead.json())).not.toContain('do-not-return-me');

      const secretDelete = await fetch(`${base}/v1/secrets/github.token`, {
        method: 'DELETE', headers,
        body: JSON.stringify({ approved: true }),
      });
      expect(secretDelete.status).toBe(200);
      expect(await secretDelete.json()).toMatchObject({ deleted: true });
    } finally {
      await new Promise<void>((accept, reject) => host.server.close((error) => error ? reject(error) : accept()));
    }
  }, 20_000);
});
