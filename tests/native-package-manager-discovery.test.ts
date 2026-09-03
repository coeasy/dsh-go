import { describe, expect, it } from 'vitest';
import {
  computeOutdated,
  isDiscoveryCommand,
  latestSearchablePackages,
  packageInfo,
  searchPackages,
} from '../runtime/discovery-cli.mjs';

const commitA = '1111111111111111111111111111111111111111';
const commitB = '2222222222222222222222222222222222222222';

function record(version: string, commit: string, updatedAt: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'memory-kit',
    version,
    channel: 'stable',
    runtime: { type: 'plugin', activation: 'restart-required' },
    capabilities: ['memory'],
    permissions: [],
    dependencies: [],
    source: {
      provider: 'github',
      repo: 'example/memory-kit',
      ref: `v${version}`,
      commit,
      updated_at: updatedAt,
      archive_url: `https://github.com/example/memory-kit/archive/${commit}.tar.gz`,
    },
    artifact: {
      kind: 'git-source',
      algorithm: 'sha256',
      integrity_scope: 'source-identity',
      integrity: `sha256-${'a'.repeat(64)}`,
    },
    metadata: {
      name: 'Memory Kit',
      description: 'Persistent memory tools for DSH',
      tags: ['memory', 'context'],
    },
    ...overrides,
  };
}

const registry = {
  registry_version: 3,
  schema_version: '3.0.0',
  defaults: { plugin_version: '0.1.0' },
  plugins: [
    record('1.9.0', commitA, '2026-08-01T00:00:00Z'),
    record('1.10.0', commitB, '2026-09-01T00:00:00Z'),
    record('2.0.0-beta.1', '3333333333333333333333333333333333333333', '2026-09-02T00:00:00Z', { channel: 'beta' }),
    record('9.0.0', '4444444444444444444444444444444444444444', '2026-09-03T00:00:00Z', { security: { yanked: true } }),
  ],
};

describe('native package manager discovery', () => {
  it('routes typed and unified package discovery commands through one read-only surface', () => {
    expect(isDiscoveryCommand(['plugin', 'search', 'memory'])).toBe(true);
    expect(isDiscoveryCommand(['package', 'search', 'memory'])).toBe(true);
    expect(isDiscoveryCommand(['package', 'info', 'mcp:dsh-go-marketplace'])).toBe(true);
    expect(isDiscoveryCommand(['plugin', 'install', 'memory-kit'])).toBe(false);
  });

  it('selects the latest non-yanked stable version per package', () => {
    const packages = latestSearchablePackages(registry, { type: 'plugin' });
    expect(packages).toHaveLength(1);
    expect(packages[0].version).toBe('1.10.0');
  });

  it('searches metadata, capabilities, tags and repository identity', () => {
    const result = searchPackages(registry, 'persistent', { type: 'plugin' });
    expect(result.count).toBe(1);
    expect(result.packages[0]).toMatchObject({
      id: 'memory-kit',
      type: 'plugin',
      version: '1.10.0',
      repo: 'example/memory-kit',
    });
  });

  it('returns an exact install command from package info', () => {
    const info = packageInfo(registry, 'plugin', 'example/memory-kit');
    expect(info.version).toBe('1.10.0');
    expect(info.install_command).toBe('dsh plugin install memory-kit@1.10.0');
  });

  it('reports installed packages that are behind the latest stable release', () => {
    const result = computeOutdated(registry, {
      packages: [{
        id: 'memory-kit',
        type: 'plugin',
        version: '1.9.0',
        commit: commitA,
        channel: 'stable',
        state: 'installed',
      }],
    }, { type: 'plugin' });

    expect(result.outdated_count).toBe(1);
    expect(result.packages[0]).toMatchObject({
      current_version: '1.9.0',
      latest_version: '1.10.0',
      outdated: true,
      status: 'outdated',
    });
  });
});
