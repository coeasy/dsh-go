import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureRegistryCache, registryCacheMetadataFile } from '../../runtime/catalog.mjs';

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('Registry V3 HTTP cache', () => {
  it('revalidates with ETag and reuses the cached payload on 304', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-registry-cache-'));
    const cacheFile = join(root, 'registry-v3.json');
    let requests = 0;
    let conditional = false;
    const payload = JSON.stringify({ registry_version: 3, plugins: [] });
    const server = createServer((req, res) => {
      requests += 1;
      if (req.headers['if-none-match'] === '"fixture-v1"') {
        conditional = true;
        res.writeHead(304, { ETag: '"fixture-v1"' });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', ETag: '"fixture-v1"' });
      res.end(payload);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    const url = `http://127.0.0.1:${address.port}/registry-v3.json`;

    const first = await ensureRegistryCache(url, { cacheFile, allowStale: false, timeout: 5000 });
    const firstText = await readFile(first, 'utf8');
    const second = await ensureRegistryCache(url, { cacheFile, allowStale: false, timeout: 5000 });

    expect(second).toBe(first);
    expect(await readFile(second, 'utf8')).toBe(firstText);
    expect(requests).toBe(2);
    expect(conditional).toBe(true);
    const metadata = JSON.parse(await readFile(registryCacheMetadataFile(cacheFile), 'utf8'));
    expect(metadata.etag).toBe('"fixture-v1"');
    expect(metadata.source).toBe(url);
    expect(metadata.checked_at).toBeTruthy();
  });
});
