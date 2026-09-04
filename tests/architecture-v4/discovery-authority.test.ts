import { describe, expect, it } from 'vitest';
import {
  DSH_MANIFEST_FILES,
  isAuthoritativeDshManifest,
  makeCatalogInstallCmd,
  normalizeStoredPlugin,
} from '../../scripts/repository-identity.mjs';
import { buildRegistryV4FromDiscovery } from '../../scripts/registry-v4-source.mjs';

function manifest(id = 'owner/canonical', version = '1.0.0', packagePath: string | null = null) {
  return {
    manifest_version: 2,
    type: 'plugin',
    id,
    version,
    channel: 'stable',
    name: 'Canonical',
    description: 'Immutable manifest fixture',
    runtime: { type: 'plugin' },
    entrypoints: { main: 'index.mjs' },
    capabilities: [],
    permissions: [],
    dependencies: [],
    compatibility: {},
    publisher: { id: 'owner' },
    security: {},
    metadata: {},
    source: { provider: 'github', repo: id === 'owner/desktop' ? 'owner/mono' : id },
    ...(packagePath ? { release: { package_path: packagePath } } : {}),
  };
}

function descriptor(input: {
  repository?: string;
  id?: string;
  version?: string;
  packagePath?: string | null;
  commit?: string;
} = {}) {
  const repository = input.repository || 'owner/canonical';
  const id = input.id || 'owner/canonical';
  const version = input.version || '1.0.0';
  const packagePath = input.packagePath || null;
  const releaseManifest = manifest(id, version, packagePath);
  const tag = packagePath ? `${id.replace('/', '-')}-v${version}` : `v${version}`;
  const manifestFile = packagePath ? `${packagePath}/dsh-package.json` : 'dsh-package.json';
  const digest = `sha256-${'d'.repeat(64)}`;
  return {
    release_version: 2,
    protocol_version: 2,
    manifest_version: 2,
    id,
    type: 'plugin',
    version,
    channel: 'stable',
    repository,
    commit: input.commit || 'b'.repeat(40),
    tag,
    published_at: '2026-09-04T00:00:00.000Z',
    manifest_file: manifestFile,
    package_path: packagePath,
    manifest: releaseManifest,
    artifact: {
      kind: 'release-archive',
      url: `https://github.com/${repository}/releases/download/${tag}/${id.replace('/', '-')}-${version}.tgz`,
      digest,
      format: 'tgz',
      strip_components: packagePath ? packagePath.split('/').length + 1 : 1,
    },
  };
}

describe('Discovery authority boundary', () => {
  it('recognizes only dsh-package.json as Manifest V2 authority', () => {
    expect(DSH_MANIFEST_FILES).toEqual(['dsh-package.json']);
    expect(isAuthoritativeDshManifest('dsh-package.json')).toBe(true);
    for (const legacy of ['dsh-plugin.json', 'dsh-mcp.json', 'dsh-skill.json', 'dsh-agent.json']) {
      expect(isAuthoritativeDshManifest(legacy)).toBe(false);
    }
  });

  it('keeps legacy manifest observations discovery-only and strips install authority', () => {
    const record = normalizeStoredPlugin({
      id: 'owner/legacy',
      full_name: 'owner/legacy',
      manifest_file: 'dsh-plugin.json',
      package_id: 'owner/legacy',
      package_type: 'plugin',
      package_version: '1.2.3',
      security: { signature: { required: true } },
      verified: true,
    });
    expect(record.verified).toBe(false);
    expect(record.manifest_file).toBeNull();
    expect(record.package_id).toBeNull();
    expect(record.package_type).toBeNull();
    expect(record.package_version).toBeNull();
    expect(record.security).toBeNull();
    expect(record.install_cmd).toBe('');
  });

  it('emits only canonical package coordinates for authoritative manifests', () => {
    const record = normalizeStoredPlugin({
      id: 'owner/pkg', full_name: 'owner/pkg', manifest_file: 'dsh-package.json',
      package_id: 'owner/pkg', package_type: 'plugin', package_version: '1.2.3', verified: true,
    });
    expect(record.verified).toBe(true);
    expect(makeCatalogInstallCmd(record)).toBe('dsh package install plugin:owner/pkg@1.2.3');
    expect(record.install_cmd).toBe('dsh package install plugin:owner/pkg@1.2.3');
  });

  it('uses Descriptor V2 commit and digest as Registry V4 release authority', async () => {
    const observationCommit = 'a'.repeat(40);
    const releaseCommit = 'b'.repeat(40);
    const built = await buildRegistryV4FromDiscovery({
      plugins: [
        {
          id: 'owner/canonical', full_name: 'owner/canonical', manifest_file: 'dsh-package.json',
          package_id: 'owner/canonical', package_type: 'plugin', package_version: '0.0.1',
          snapshot_commit: observationCommit, verified: true,
        },
        {
          id: 'owner/legacy', full_name: 'owner/legacy', manifest_file: 'dsh-plugin.json',
          package_id: 'owner/legacy', package_type: 'plugin', package_version: '1.0.0',
          snapshot_commit: observationCommit, verified: true,
        },
      ],
    }, {
      generated_at: '2026-09-04T00:00:00.000Z',
      concurrency: 1,
      loadManifest: async (repo: string) => repo === 'owner/canonical' ? manifest() : null,
      loadReleaseDescriptor: async (repo: string) => repo === 'owner/canonical'
        ? descriptor({ commit: releaseCommit })
        : null,
    });

    expect(built.registry.packages.map((item: any) => item.id)).toEqual(['owner/canonical']);
    const release: any = built.registry.packages[0].releases[0];
    expect(release.version).toBe('1.0.0');
    expect(release.commit).toBe(releaseCommit);
    expect(release.artifact).toMatchObject({
      kind: 'release-archive',
      digest: `sha256-${'d'.repeat(64)}`,
      integrity: `sha256-${'d'.repeat(64)}`,
    });
    const accepted: any = built.candidates.candidates.find((item: any) => item.repo === 'owner/canonical');
    expect(accepted?.status).toBe('accepted');
    expect(accepted?.observation_commit).toBe(observationCommit);
    expect(accepted?.commit).toBe(releaseCommit);
    const legacy = built.candidates.candidates.find((item: any) => item.repo === 'owner/legacy');
    expect(legacy?.status).toBe('quarantined');
    expect(legacy?.reason).toBe('manifest-v2-required');
  });

  it('quarantines Manifest V2 when immutable Descriptor V2 has not been published', async () => {
    const commit = 'a'.repeat(40);
    const built = await buildRegistryV4FromDiscovery({
      plugins: [{
        id: 'owner/canonical', full_name: 'owner/canonical', manifest_file: 'dsh-package.json',
        package_id: 'owner/canonical', package_type: 'plugin', package_version: '1.0.0',
        snapshot_commit: commit, verified: true,
      }],
    }, {
      generated_at: '2026-09-04T00:00:00.000Z',
      concurrency: 1,
      loadManifest: async () => manifest(),
      loadReleaseDescriptor: async () => null,
    });
    expect(built.registry.packages).toEqual([]);
    expect(built.candidates.candidates[0]).toMatchObject({
      status: 'quarantined',
      reason: 'release-descriptor-v2-required',
      observation_commit: commit,
    });
  });

  it('registers scoped monorepo packages through explicit source declarations', async () => {
    const observationCommit = 'a'.repeat(40);
    const releaseCommit = 'c'.repeat(40);
    const packagePath = 'packages/desktop';
    const built = await buildRegistryV4FromDiscovery({ plugins: [] }, {
      generated_at: '2026-09-04T00:00:00.000Z',
      concurrency: 1,
      explicitSources: [{ repository: 'owner/mono', package_path: packagePath, ref: 'main', enabled: true }],
      resolveCommit: async (repo: string, ref: string) => {
        expect(repo).toBe('owner/mono');
        expect(ref).toBe('main');
        return observationCommit;
      },
      loadManifest: async (repo: string, commit: string, _token: string, path: string) => {
        expect(repo).toBe('owner/mono');
        expect(commit).toBe(observationCommit);
        expect(path).toBe(packagePath);
        return manifest('owner/desktop', '2.0.0', packagePath);
      },
      loadReleaseDescriptor: async (repo: string, currentManifest: any, path: string) => {
        expect(repo).toBe('owner/mono');
        expect(currentManifest.id).toBe('owner/desktop');
        expect(path).toBe(packagePath);
        return descriptor({ repository: 'owner/mono', id: 'owner/desktop', version: '2.0.0', packagePath, commit: releaseCommit });
      },
    });

    expect(built.registry.metadata.explicit_source_count).toBe(1);
    expect(built.registry.packages).toHaveLength(1);
    expect(built.registry.packages[0].id).toBe('owner/desktop');
    expect(built.registry.packages[0].releases[0]).toMatchObject({ version: '2.0.0', commit: releaseCommit });
    expect(built.candidates.counts.accepted).toBe(1);
  });
});
