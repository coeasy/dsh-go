import { describe, expect, it } from 'vitest';
import { buildDependencyPlan, resolvePlugin } from '../../runtime/resolver.mjs';

function item(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    version: '0.1.0',
    channel: 'stable',
    source: { repo: `owner/${id}`, ref: 'main', commit: 'a'.repeat(40), archive_url: `https://github.com/owner/${id}/archive/${'a'.repeat(40)}.tar.gz` },
    artifact: { integrity: `sha256-${'b'.repeat(64)}` },
    runtime: { type: 'plugin', activation: 'restart-required' },
    capabilities: ['plugin'],
    dependencies: [],
    metadata: {},
    ...extra,
  };
}

const registry = {
  registry_version: 3,
  defaults: { plugin_version: '0.1.0' },
  plugins: [
    item('sql-provider', { provides: ['cap.sql'] }),
    item('consumer', { dependencies: [{ id: 'cap.sql', range: '*' }], replaces: ['legacy-consumer'] }),
    item('exclusive', { conflicts: ['cap.sql'] }),
    item('yanked-provider', { provides: ['cap.yanked'], security: { yanked: true } }),
    item('needs-yanked', { dependencies: [{ id: 'yanked-provider', range: '*' }] }),
  ],
};

describe('resolver v3 ecosystem semantics', () => {
  it('resolves virtual capabilities through provides', () => {
    expect(resolvePlugin(registry, 'cap.sql', '*')).toMatchObject({ id: 'sql-provider', provides: ['cap.sql'] });
    const plan = buildDependencyPlan(registry, resolvePlugin(registry, 'consumer', '*'));
    expect(plan.order.map((entry: { id: string }) => entry.id)).toEqual(['sql-provider', 'consumer']);
    expect(plan.declared_replacements).toEqual(['legacy-consumer']);
  });

  it('blocks conflicts against installed providers', () => {
    const root = resolvePlugin(registry, 'exclusive', '*');
    expect(() => buildDependencyPlan(registry, root, { installed: [{ id: 'sql-provider', provides: ['cap.sql'], state: 'active' }] })).toThrow(/package conflict/);
  });

  it('blocks yanked direct packages, virtual providers, and transitive dependencies by default', () => {
    expect(() => resolvePlugin(registry, 'yanked-provider', '*')).toThrow(/yanked/);
    expect(() => resolvePlugin(registry, 'cap.yanked', '*')).toThrow(/yanked/);
    expect(() => buildDependencyPlan(registry, resolvePlugin(registry, 'needs-yanked', '*'))).toThrow(/yanked/);
    expect(resolvePlugin(registry, 'yanked-provider', '*', { allowYanked: true })).toMatchObject({
      id: 'yanked-provider',
      security: { yanked: true },
    });
  });
});
