import { describe, expect, it } from 'vitest';

const { buildDependencyPlan, resolvePlugin } = await import('../../runtime/resolver.mjs');
const { satisfiesVersion } = await import('../../runtime/semver.mjs');

function plugin(id: string, version: string, dependencies: unknown[] = [], channel = 'stable') {
  return {
    id,
    version,
    channel,
    source: { provider: 'github', repo: `owner/${id}`, ref: 'main', commit: '0123456789abcdef0123456789abcdef01234567' },
    artifact: { integrity: 'sha256-test' },
    runtime: { type: 'plugin' },
    dependencies,
  };
}

describe('Runtime Platform V2 dependency resolver', () => {
  it('supports semantic ranges and release channels', () => {
    const registry = {
      registry_version: 3,
      defaults: { plugin_version: '0.1.0' },
      plugins: [plugin('demo', '0.1.0'), plugin('demo', '0.2.0', [], 'beta')],
    };
    expect(satisfiesVersion('0.2.5', '^0.2.0')).toBe(true);
    expect(satisfiesVersion('0.3.0', '^0.2.0')).toBe(false);
    expect(resolvePlugin(registry, 'demo', '*', { channel: 'stable' }).version).toBe('0.1.0');
    expect(resolvePlugin(registry, 'demo', '*', { channel: 'beta' }).version).toBe('0.2.0');
  });

  it('creates dependency-first install plans', () => {
    const dep = plugin('dep', '1.2.0');
    const root = plugin('root', '0.1.0', [{ id: 'dep', range: '^1.0.0' }]);
    const registry = { registry_version: 3, defaults: { plugin_version: '0.1.0' }, plugins: [root, dep] };
    const plan = buildDependencyPlan(registry, root);
    expect(plan.order.map((item: any) => item.id)).toEqual(['dep', 'root']);
    expect(plan.graph.root[0].version).toBe('1.2.0');
  });

  it('rejects cycles and incompatible dependency constraints', () => {
    const a = plugin('a', '1.0.0', ['b@1.0.0']);
    const b = plugin('b', '1.0.0', ['a@1.0.0']);
    const cyclic = { registry_version: 3, defaults: { plugin_version: '0.1.0' }, plugins: [a, b] };
    expect(() => buildDependencyPlan(cyclic, a)).toThrow(/dependency cycle/);

    const x1 = plugin('x', '1.5.0');
    const x2 = plugin('x', '2.1.0');
    const child = plugin('child', '1.0.0', ['x@^2.0.0']);
    const root = plugin('root', '1.0.0', ['x@^1.0.0', 'child@1.0.0']);
    const conflicting = { registry_version: 3, defaults: { plugin_version: '0.1.0' }, plugins: [root, child, x1, x2] };
    expect(() => buildDependencyPlan(conflicting, root)).toThrow(/dependency conflict/);
  });
});
