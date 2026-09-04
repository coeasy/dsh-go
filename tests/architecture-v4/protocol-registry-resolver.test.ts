import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  ProtocolError,
  compareVersion,
  formatPackageCoordinate,
  normalizePackageRequest,
  parsePackageCoordinate,
  satisfiesRange,
} from '../../packages/protocol-core/index.mjs';
import { buildRegistryV4, validateRegistryV4 } from '../../packages/registry-core/index.mjs';
import { resolvePackage } from '../../packages/resolver/index.mjs';

const commit = (char: string) => char.repeat(40);

function record(overrides: Record<string, any> = {}) {
  return {
    type: 'skill',
    id: 'owner/example',
    version: '1.2.0',
    channel: 'stable',
    source: { provider: 'github', repo: 'owner/example', commit: commit('a') },
    capabilities: ['skill'],
    dependencies: [],
    permissions: ['network:https'],
    compatibility: { dsh: '^1.0.0' },
    security: {},
    publisher: { id: 'owner', repository_ownership: 'verified', verified: true },
    metadata: { name: 'Example', stars: 250, verified: true },
    ...overrides,
  };
}

describe('Package Protocol V2', () => {
  it('requires an explicit package type and canonicalizes identity', () => {
    const request = parsePackageCoordinate('Skill:Owner/Example@^1.2.0', { channel: 'stable' });
    expect(request).toEqual({ type: 'skill', id: 'owner/example', range: '^1.2.0', channel: 'stable' });
    expect(formatPackageCoordinate(request)).toBe('skill:owner/example@^1.2.0');
    expect(() => parsePackageCoordinate('owner/example@1.2.0')).toThrow(/explicit type/i);
  });

  it('implements deterministic SemVer precedence and ranges', () => {
    expect(compareVersion('1.2.0', '1.2.0-rc.1')).toBeGreaterThan(0);
    expect(compareVersion('1.2.0-rc.10', '1.2.0-rc.2')).toBeGreaterThan(0);
    expect(satisfiesRange('1.9.9', '^1.2.0')).toBe(true);
    expect(satisfiesRange('2.0.0', '^1.2.0')).toBe(false);
    expect(satisfiesRange('1.3.4', '>=1.2.0 <2.0.0')).toBe(true);
    expect(satisfiesRange('2.0.0', '1.x || >=2.1.0')).toBe(false);
    expect(satisfiesRange('2.2.0', '1.x || >=2.1.0')).toBe(true);
  });

  it('rejects unsafe IDs and unsupported channels', () => {
    expect(() => normalizePackageRequest({ type: 'plugin', id: '../evil', range: '*', channel: 'stable' })).toThrow();
    expect(() => normalizePackageRequest({ type: 'plugin', id: 'owner/pkg', range: '*', channel: 'edge' })).toThrow(/channel/i);
  });
});

describe('Registry V4 and Resolver V2', () => {
  it('builds one package with immutable releases and stable revision', () => {
    const registry = buildRegistryV4([
      record(),
      record({ version: '1.3.0', source: { provider: 'github', repo: 'owner/example', commit: commit('b') } }),
    ], { generated_at: '2026-09-04T00:00:00.000Z' });
    expect(registry.schema_version).toBe(4);
    expect(registry.packages).toHaveLength(1);
    expect(registry.packages[0].releases.map((release: any) => release.version)).toEqual(['1.3.0', '1.2.0']);
    expect(registry.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(validateRegistryV4(structuredClone(registry)).revision).toBe(registry.revision);
  });

  it('resolves dependency graph in dependency-first order and aggregates permissions', () => {
    const registry = buildRegistryV4([
      record({ type: 'plugin', id: 'owner/root', version: '2.0.0', source: { provider: 'github', repo: 'owner/root', commit: commit('c') }, dependencies: [{ type: 'skill', id: 'owner/example', range: '^1.0.0' }], permissions: ['filesystem:workspace'] }),
      record(),
      record({ version: '1.4.0', source: { provider: 'github', repo: 'owner/example', commit: commit('d') } }),
    ], { generated_at: '2026-09-04T00:00:00.000Z' });
    const plan = resolvePackage(registry, { type: 'plugin', id: 'owner/root', range: '*', channel: 'stable' }, { dsh_version: '1.5.0', os: 'linux', arch: 'x64' });
    expect(plan.protocol_version).toBe(2);
    expect(plan.root.key).toBe('plugin:owner/root');
    expect(plan.graph.find((node: any) => node.key === 'skill:owner/example')?.version).toBe('1.4.0');
    expect(plan.order).toEqual(['skill:owner/example', 'plugin:owner/root']);
    expect(plan.permissions).toEqual(['filesystem:workspace', 'network:https']);
    expect(plan.resolution_hash).toMatch(/^r2-[0-9a-f]{16}$/);
  });

  it('fails closed for revoked and critical releases', () => {
    const revoked = buildRegistryV4([record({ security: { revoked: true } })]);
    expect(() => resolvePackage(revoked, { type: 'skill', id: 'owner/example', range: '*', channel: 'stable' })).toThrow(ProtocolError);
    try { resolvePackage(revoked, { type: 'skill', id: 'owner/example', range: '*', channel: 'stable' }); } catch (error: any) { expect(error.code).toBe(ERROR_CODES.PACKAGE_REVOKED); }

    const critical = buildRegistryV4([record({ security: { advisories: [{ id: 'ADV-1', severity: 'critical', affected: '*' }] } })]);
    try { resolvePackage(critical, { type: 'skill', id: 'owner/example', range: '*', channel: 'stable' }); } catch (error: any) { expect(error.code).toBe(ERROR_CODES.SECURITY_ADVISORY_BLOCKED); }
  });

  it('detects dependency cycles', () => {
    const registry = buildRegistryV4([
      record({ type: 'plugin', id: 'owner/a', source: { provider: 'github', repo: 'owner/a', commit: commit('e') }, dependencies: [{ type: 'skill', id: 'owner/b', range: '*' }] }),
      record({ id: 'owner/b', source: { provider: 'github', repo: 'owner/b', commit: commit('f') }, dependencies: [{ type: 'plugin', id: 'owner/a', range: '*' }] }),
    ]);
    expect(() => resolvePackage(registry, { type: 'plugin', id: 'owner/a', range: '*', channel: 'stable' })).toThrow(/cycle/i);
  });
});
