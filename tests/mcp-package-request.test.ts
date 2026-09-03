import { describe, expect, it } from 'vitest';
import { resolveEdgePackageRequest, satisfiesSemanticVersion } from '../functions/_package-request';
import type { RegistryV3Plugin } from '../functions/_registry';
import { satisfiesVersion } from '../runtime/semver.mjs';

function record(version: string, options: Partial<RegistryV3Plugin> = {}): RegistryV3Plugin {
  return {
    id: 'demo',
    version,
    channel: 'stable',
    source: {
      provider: 'github',
      repo: 'owner/demo',
      ref: 'main',
      commit: version.replace(/\D/g, '').padEnd(40, '0').slice(0, 40),
    },
    runtime: { type: 'plugin', activation: 'restart-required' },
    capabilities: [],
    dependencies: [],
    permissions: [],
    metadata: {},
    ...options,
  };
}

describe('MCP PackageRequest resolution', () => {
  it('selects latest stable by default and honors exact/range/channel requests', () => {
    const plugins: RegistryV3Plugin[] = [
      record('1.9.0'),
      record('1.10.0'),
      record('2.0.0-beta.1', { channel: 'beta' }),
    ];
    expect(resolveEdgePackageRequest(plugins, { id: 'demo', type: 'plugin' }).package.version).toBe('1.10.0');
    expect(resolveEdgePackageRequest(plugins, { id: 'owner/demo', type: 'plugin', version: '1.9.0' }).package.version).toBe('1.9.0');
    expect(resolveEdgePackageRequest(plugins, { id: 'demo', type: 'plugin', version: '^1.9.0' }).package.version).toBe('1.10.0');
    expect(resolveEdgePackageRequest(plugins, { id: 'demo', type: 'plugin', channel: 'beta' }).package.version).toBe('2.0.0-beta.1');
  });

  it('rejects ambiguity across package types and excludes yanked releases', () => {
    const plugins: RegistryV3Plugin[] = [
      record('1.0.0'),
      record('1.1.0', { security: { yanked: true } }),
      record('1.0.0', { type: 'mcp', runtime: { type: 'mcp', activation: 'restart-required' } }),
    ];
    expect(() => resolveEdgePackageRequest(plugins, { id: 'demo' })).toThrow(/ambiguous/);
    expect(resolveEdgePackageRequest(plugins, { id: 'demo', type: 'plugin' }).package.version).toBe('1.0.0');
  });

  it('keeps edge semver matching aligned with the local Runtime resolver contract', () => {
    const versions = ['0.1.0', '0.1.5', '0.2.0', '1.0.0', '1.2.3', '1.3.0', '2.0.0-beta.1', '2.0.0'];
    const ranges = ['*', 'latest', '1.2.3', '^1.2.3', '~1.2.3', '>=1.0.0 <2.0.0', '1.x.x', '>=2.0.0-beta.1'];
    for (const version of versions) {
      for (const range of ranges) {
        expect(satisfiesSemanticVersion(version, range), `${version} ${range}`).toBe(satisfiesVersion(version, range));
      }
    }
  });
});
