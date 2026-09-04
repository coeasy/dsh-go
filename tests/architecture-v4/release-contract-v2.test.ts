import { describe, expect, it } from 'vitest';
import {
  PACKAGE_RELEASE_DESCRIPTOR_VERSION,
  packageReleaseTag,
} from '../../packages/protocol-core/manifest.mjs';
import { discoverReleaseArtifact } from '../../runtime/release-discovery.mjs';

function manifest() {
  return {
    manifest_version: 2,
    type: 'plugin',
    id: 'owner/example',
    version: '1.2.3',
    channel: 'stable',
    name: 'Example',
    description: 'Release contract fixture',
    runtime: { type: 'plugin' },
    entrypoints: { main: 'index.mjs' },
    capabilities: [],
    permissions: [],
    dependencies: [],
    compatibility: {},
    publisher: { id: 'owner' },
    security: {},
    metadata: {},
    source: { provider: 'github', repo: 'owner/example' },
  };
}

function descriptor(releaseVersion = PACKAGE_RELEASE_DESCRIPTOR_VERSION) {
  return {
    release_version: releaseVersion,
    protocol_version: 2,
    manifest_version: 2,
    id: 'owner/example',
    type: 'plugin',
    version: '1.2.3',
    channel: 'stable',
    repository: 'owner/example',
    commit: 'a'.repeat(40),
    tag: 'owner-example-v1.2.3',
    package_path: 'packages/example',
    manifest: manifest(),
    artifact: {
      kind: 'release-archive',
      url: 'https://github.com/owner/example/releases/download/owner-example-v1.2.3/owner-example-1.2.3.tgz',
      digest: `sha256-${'b'.repeat(64)}`,
      format: 'tgz',
      strip_components: 2,
    },
  };
}

describe('Release Descriptor V2 contract', () => {
  it('uses one canonical release tag formatter for root and scoped packages', () => {
    expect(packageReleaseTag({ id: 'owner/example', version: '1.2.3' })).toBe('v1.2.3');
    expect(packageReleaseTag({ id: 'owner/example', version: '1.2.3', package_path: 'packages/example' })).toBe('owner-example-v1.2.3');
  });

  it('discovers the exact Descriptor V2 emitted by the package release pipeline', async () => {
    const calls: string[] = [];
    const artifact = await discoverReleaseArtifact({
      type: 'plugin',
      id: 'owner/example',
      version: '1.2.3',
      repo: 'owner/example',
      commit: 'a'.repeat(40),
      package_path: 'packages/example',
    }, {
      fetch: async (url: string) => {
        calls.push(String(url));
        return new Response(JSON.stringify(descriptor()), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    expect(calls[0]).toContain('/owner-example-v1.2.3/dsh-package-release.json');
    expect(artifact).toMatchObject({ kind: 'release-archive', release_tag: 'owner-example-v1.2.3', package_path: 'packages/example' });
  });

  it('fails closed on Descriptor V1 instead of accepting an incompatible release surface', async () => {
    await expect(discoverReleaseArtifact({
      type: 'plugin',
      id: 'owner/example',
      version: '1.2.3',
      repo: 'owner/example',
      commit: 'a'.repeat(40),
      package_path: 'packages/example',
    }, {
      fetch: async () => new Response(JSON.stringify(descriptor(1)), { status: 200, headers: { 'content-type': 'application/json' } }),
    })).rejects.toMatchObject({ code: 'DSH_RELEASE_DESCRIPTOR_INVALID' });
  });
});
