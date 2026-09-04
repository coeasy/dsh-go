import { describe, expect, it } from 'vitest';
import {
  DSH_MANIFEST_FILES,
  isAuthoritativeDshManifest,
  makeCatalogInstallCmd,
  normalizeStoredPlugin,
} from '../../scripts/repository-identity.mjs';
import { buildRegistryV4FromDiscovery } from '../../scripts/registry-v4-source.mjs';

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

  it('revalidates canonical Manifest V2 at immutable commit and quarantines a legacy candidate', async () => {
    const commit = 'a'.repeat(40);
    const built = await buildRegistryV4FromDiscovery({
      plugins: [
        {
          id: 'owner/canonical', full_name: 'owner/canonical', manifest_file: 'dsh-package.json',
          package_id: 'owner/canonical', package_type: 'plugin', package_version: '0.0.1',
          snapshot_commit: commit, verified: true,
        },
        {
          id: 'owner/legacy', full_name: 'owner/legacy', manifest_file: 'dsh-plugin.json',
          package_id: 'owner/legacy', package_type: 'plugin', package_version: '1.0.0',
          snapshot_commit: commit, verified: true,
        },
      ],
    }, {
      generated_at: '2026-09-04T00:00:00.000Z',
      concurrency: 1,
      loadManifest: async (repo: string) => repo === 'owner/canonical' ? ({
        manifest_version: 2,
        type: 'plugin',
        id: 'owner/canonical',
        version: '1.0.0',
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
        source: { provider: 'github', repo: 'owner/canonical' },
      }) : null,
    });

    expect(built.registry.packages.map((item: any) => item.id)).toEqual(['owner/canonical']);
    expect(built.registry.packages[0].releases[0].version).toBe('1.0.0');
    expect(built.candidates.candidates.find((item: any) => item.repo === 'owner/canonical')?.status).toBe('accepted');
    const legacy = built.candidates.candidates.find((item: any) => item.repo === 'owner/legacy');
    expect(legacy?.status).toBe('quarantined');
    expect(legacy?.reason).toBe('manifest-v2-required');
  });
});
