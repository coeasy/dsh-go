import { describe, expect, it } from 'vitest';
import { preflightPackage } from '../runtime/preflight.mjs';
import { resolvePackage } from '../runtime/resolver.mjs';
import { dependencyGraphFromExplanation, explainPackageResolution } from '../runtime/solver-explain.mjs';

function item(id: string, version: string, options: any = {}) {
  const commit = options.commit || `${version.replaceAll('.', '')}a`.repeat(40).slice(0, 40);
  return {
    id, version, channel: options.channel || 'stable',
    source: { provider: 'github', repo: options.repo || `owner/${id}`, ref: 'main', commit },
    artifact: { kind: 'git-source', integrity: `sha256-${id}-${version}` },
    runtime: { type: options.type || 'plugin' }, capabilities: [options.type || 'plugin'],
    dependencies: options.dependencies || [], permissions: options.permissions || [],
    conflicts: options.conflicts || [], replaces: [], provides: options.provides || [],
    security: options.security || {}, metadata: {},
  };
}

function registry(plugins: any[]) {
  return { registry_version: 3, schema_version: '3.0.0', defaults: { plugin_version: '0.1.0' }, plugins };
}

describe('Solver V2 explanation and security policy', () => {
  it('explains highest compatible selection, rejected candidates, constraints and dependency graph', () => {
    const data = registry([
      item('dep', '1.0.0'),
      item('dep', '1.5.0'),
      item('root', '1.0.0', { dependencies: [{ id: 'dep', type: 'plugin', range: '^1.0.0' }] }),
      item('root', '1.5.0', { dependencies: [{ id: 'dep', type: 'plugin', range: '^1.0.0' }] }),
      item('root', '2.0.0'),
    ]);
    const explanation = explainPackageResolution(data, 'plugin:root@^1.0.0', { type: 'plugin', channel: 'stable', installed: [] });
    expect(explanation.resolved).toBe(true);
    expect(explanation.selected).toMatchObject({ id: 'root', version: '1.5.0' });
    expect(explanation.candidates.find((candidate: any) => candidate.version === '1.5.0')?.decision).toBe('selected-highest-compatible');
    expect(explanation.candidates.find((candidate: any) => candidate.version === '1.0.0')?.decision).toBe('lower-compatible-version');
    expect(explanation.candidates.find((candidate: any) => candidate.version === '2.0.0')?.decision).toBe('does-not-satisfy:^1.0.0');
    expect(explanation.dependency_plan.graph.root).toEqual([expect.objectContaining({ id: 'dep', range: '^1.0.0', version: '1.5.0' })]);
    expect(explanation.dependency_plan.constraints['plugin:dep']).toBe('^1.0.0');
    const graph = dependencyGraphFromExplanation(explanation);
    expect(graph.order.map((entry: any) => entry.id)).toEqual(['dep', 'root']);
  });

  it('fails closed for revoked, yanked and active high/critical advisory releases', () => {
    expect(() => resolvePackage(registry([item('revoked', '1.0.0', { security: { revoked: true } })]), 'plugin', 'revoked', '*'))
      .toThrowError(expect.objectContaining({ code: 'DSH_PACKAGE_REVOKED' }));
    expect(() => resolvePackage(registry([item('yanked', '1.0.0', { security: { yanked: true } })]), 'plugin', 'yanked', '*'))
      .toThrowError(expect.objectContaining({ code: 'DSH_PACKAGE_YANKED' }));
    expect(() => resolvePackage(registry([item('vuln', '1.0.0', { security: { advisories: [{ id: 'GHSA-test', severity: 'high' }] } })]), 'plugin', 'vuln', '*'))
      .toThrowError(expect.objectContaining({ code: 'DSH_SECURITY_ADVISORY_BLOCKED' }));

    const low = resolvePackage(registry([item('low', '1.0.0', { security: { advisories: [{ id: 'ADV-low', severity: 'low' }] } })]), 'plugin', 'low', '*');
    expect(low.version).toBe('1.0.0');
    expect(low.advisories).toEqual([expect.objectContaining({ id: 'ADV-low', severity: 'low' })]);
  });

  it('treats any newly added permission on an installed package/dependency as an escalation requiring fresh consent', () => {
    const data = registry([
      item('dep', '2.0.0', { permissions: ['network'] }),
      item('root', '2.0.0', { dependencies: [{ id: 'dep', type: 'plugin', range: '*' }] }),
    ]);
    const installed = [
      { type: 'plugin', id: 'root', version: '1.0.0', state: 'active', permissions: [] },
      { type: 'plugin', id: 'dep', version: '1.0.0', state: 'active', permissions: [] },
    ];
    const preflight = preflightPackage(data, 'plugin:root@2.0.0', { type: 'plugin', installed });
    expect(preflight.allowed).toBe(true);
    expect(preflight.permission_escalation).toBe(true);
    expect(preflight.permission_escalations).toEqual([
      expect.objectContaining({ key: 'plugin:dep', added: ['network'], from_version: '1.0.0', to_version: '2.0.0' }),
    ]);
    expect(preflight.package_checks.find((entry: any) => entry.id === 'dep')).toMatchObject({ permission_escalation: true });
  });
});
