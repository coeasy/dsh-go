import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { downloadReleaseArtifact, validateReleaseArtifact } from '../../runtime/artifact-installer.mjs';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

function artifact(url = 'https://artifacts.example.com/package.tgz', body = Buffer.from('package')) {
  return {
    kind: 'release-archive',
    url,
    digest: `sha256-${createHash('sha256').update(body).digest('hex')}`,
    format: 'tgz',
    strip_components: 1,
  };
}

describe('release artifact network security', () => {
  it('rejects localhost, private literal addresses and credential-bearing URLs before download', () => {
    for (const url of [
      'https://127.0.0.1/package.tgz',
      'https://10.0.0.1/package.tgz',
      'https://user:secret@artifacts.example.com/package.tgz',
      'https://localhost/package.tgz',
    ]) {
      const validation = validateReleaseArtifact(artifact(url));
      expect(validation.ok, url).toBe(false);
      expect(validation.errors.join(' '), url).toMatch(/unsafe/i);
    }
  });

  it('rejects a DNS name that resolves to a private address before issuing a request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-artifact-ssrf-'));
    dirs.push(root);
    let fetched = false;
    await expect(downloadReleaseArtifact(artifact(), join(root, 'package.tgz'), {
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      fetch: async () => { fetched = true; return new Response('unexpected'); },
    })).rejects.toThrow(/private|loopback|reserved/i);
    expect(fetched).toBe(false);
  });

  it('revalidates every redirect target and blocks a redirect into a private network', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-artifact-redirect-'));
    dirs.push(root);
    let calls = 0;
    await expect(downloadReleaseArtifact(artifact(), join(root, 'package.tgz'), {
      lookup: async () => [{ address: '1.1.1.1', family: 4 }],
      fetch: async () => {
        calls += 1;
        return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/internal' } });
      },
    })).rejects.toThrow(/private|loopback|reserved/i);
    expect(calls).toBe(1);
  });

  it('still downloads a digest-bound artifact through a safe public endpoint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-artifact-safe-'));
    dirs.push(root);
    const body = Buffer.from('verified-package');
    const target = join(root, 'package.tgz');
    const result = await downloadReleaseArtifact(artifact('https://artifacts.example.com/package.tgz', body), target, {
      lookup: async () => [{ address: '1.1.1.1', family: 4 }],
      fetch: async () => new Response(body, { status: 200, headers: { 'content-length': String(body.byteLength) } }),
    });
    expect(result.url).toBe('https://artifacts.example.com/package.tgz');
    expect(await readFile(target)).toEqual(body);
  });
});
