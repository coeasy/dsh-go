import { describe, expect, it } from 'vitest';

const { buildDependencyPlan, resolvePackage } = await import('../../runtime/resolver.mjs');

const commit = '0123456789abcdef0123456789abcdef01234567';

function pkg(type: 'plugin' | 'mcp' | 'skill' | 'agent', id: string, version: string, dependencies: unknown[] = []) {
  return {
    id,
    version,
    channel: 'stable',
    source: { provider: 'github', repo: `owner/${type}-${id}`, ref: 'main', commit },
    artifact: { integrity: 'sha256-test' },
    runtime: { type },
    capabilities: [type],
    dependencies,
  };
}

describe('Runtime Platform V3 mixed-type resolver', () => {
  it('resolves the same id independently for each package type', () => {
    const registry = {
      registry_version: 3,
      defaults: { plugin_version: '0.1.0' },
      plugins: [pkg('plugin', 'demo', '1.0.0'), pkg('mcp', 'demo', '2.0.0')],
    };
    expect(resolvePackage(registry, 'plugin', 'demo', '*').version).toBe('1.0.0');
    expect(resolvePackage(registry, 'mcp', 'demo', '*').version).toBe('2.0.0');
  });

  it('builds dependency-first plans across plugin, MCP, skill, and agent packages', () => {
    const core = pkg('plugin', 'core', '1.0.0');
    const server = pkg('mcp', 'server', '1.0.0', ['core@1.0.0']);
    const helper = pkg('skill', 'helper', '1.0.0', ['mcp:server@1.0.0']);
    const agent = pkg('agent', 'worker', '1.0.0', ['skill:helper@1.0.0']);
    const registry = { registry_version: 3, plugins: [agent, helper, server, core] };
    const resolvedAgent = resolvePackage(registry, 'agent', 'worker', '1.0.0');
    const plan = buildDependencyPlan(registry, resolvedAgent);
    expect(plan.order.map((item: any) => `${item.type}:${item.id}`)).toEqual([
      'plugin:core', 'mcp:server', 'skill:helper', 'agent:worker',
    ]);
    expect((plan.graph as Record<string, any[]>)['agent:worker'][0].type).toBe('skill');
  });

  it('detects cycles across package types', () => {
    const server = pkg('mcp', 'server', '1.0.0', ['skill:helper@1.0.0']);
    const helper = pkg('skill', 'helper', '1.0.0', ['mcp:server@1.0.0']);
    const registry = { registry_version: 3, plugins: [server, helper] };
    expect(() => buildDependencyPlan(registry, resolvePackage(registry, 'mcp', 'server', '1.0.0'))).toThrow(/dependency cycle/);
  });
});
