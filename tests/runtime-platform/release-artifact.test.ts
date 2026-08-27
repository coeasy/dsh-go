import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { artifactIntegrity } = await import('../../scripts/checksum.mjs');
const { downloadReleaseArtifact, validateReleaseArtifact } = await import('../../runtime/artifact-installer.mjs');
const { discoverReleaseArtifact, RELEASE_DESCRIPTOR_NAME } = await import('../../runtime/release-discovery.mjs');

function resolved() {
  const source = { provider: 'github', repo: 'owner/fixture', ref: 'main', commit: 'a'.repeat(40) };
  return {
    id: 'fixture',
    type: 'plugin',
    version: '0.1.0',
    repo: source.repo,
    commit: source.commit,
    source,
    integrity: artifactIntegrity({ version: '0.1.0', source }),
    artifact: {
      kind: 'git-source',
      algorithm: 'sha256',
      integrity_scope: 'source-identity',
      integrity: artifactIntegrity({ version: '0.1.0', source }),
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('release artifact runtime path', () => {
  it('discovers only a release descriptor bound to the Registry identity', async () => {
    const pkg = resolved();
    const body = Buffer.from('release-payload');
    const digest = `sha256-${createHash('sha256').update(body).digest('hex')}`;
    const descriptor = {
      release_version: 1,
      id: pkg.id,
      type: pkg.type,
      version: pkg.version,
      repository: pkg.repo,
      commit: pkg.commit,
      tag: 'v0.1.0',
      artifact: {
        kind: 'release-archive',
        url: 'https://github.com/owner/fixture/releases/download/v0.1.0/fixture-0.1.0.tgz',
        digest,
        format: 'tgz',
        strip_components: 1,
      },
    };
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain(RELEASE_DESCRIPTOR_NAME);
      return new Response(JSON.stringify(descriptor), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const artifact = await discoverReleaseArtifact(pkg);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(artifact).toMatchObject({ kind: 'release-archive', digest, release_tag: 'v0.1.0' });
  });

  it('ignores a release descriptor for a different immutable commit', async () => {
    const pkg = resolved();
    const descriptor = {
      release_version: 1,
      id: pkg.id,
      type: pkg.type,
      version: pkg.version,
      repository: pkg.repo,
      commit: 'b'.repeat(40),
      artifact: {
        kind: 'release-archive',
        url: 'https://github.com/owner/fixture/releases/download/v0.1.0/fixture-0.1.0.tgz',
        digest: `sha256-${'c'.repeat(64)}`,
        format: 'tgz',
      },
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(descriptor), { status: 200 })));
    await expect(discoverReleaseArtifact(pkg)).resolves.toBeNull();
  });

  it('downloads release bytes only when SHA256 matches', async () => {
    const bytes = Buffer.from('verified release artifact');
    const digest = `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
    const artifact = {
      kind: 'release-archive',
      url: 'https://github.com/owner/fixture/releases/download/v0.1.0/fixture-0.1.0.tgz',
      digest,
      format: 'tgz',
      strip_components: 1,
    };
    expect(validateReleaseArtifact(artifact).ok).toBe(true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes, { status: 200 })));
    const root = await mkdtemp(join(tmpdir(), 'dsh-release-download-'));
    const file = join(root, 'artifact.tgz');
    const result = await downloadReleaseArtifact(artifact, file);
    expect(result.digest).toBe(digest);
    expect(await readFile(file)).toEqual(bytes);
  });

  it('rejects insecure release URLs before download', () => {
    const result = validateReleaseArtifact({
      kind: 'release-archive',
      url: 'http://example.test/package.tgz',
      digest: `sha256-${'d'.repeat(64)}`,
      format: 'tgz',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('https');
  });
});
