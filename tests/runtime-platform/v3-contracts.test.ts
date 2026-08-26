import { describe, expect, it } from 'vitest';
import { bindRuntime } from '../../runtime/v3/binding/runtime-binding';
import { createRuntimeInstallPlan } from '../../runtime/v3/installer/installer';
import { resolvePackageDependencies } from '../../runtime/v3/resolver/dependency-resolver';
import { RuntimeRegistryStore } from '../../runtime/v3/storage/registry-store';

describe('Runtime V3 TypeScript compatibility contracts', () => {
  it('uses typed package identity across storage, planning, resolution, and binding', () => {
    const store = new RuntimeRegistryStore({
      schema_version: 2,
      plugins: [{ id: 'same', version: '1.0.0', state: 'installed' }],
    });
    store.upsert({ id: 'same', type: 'mcp', version: '2.0.0', state: 'installed' });
    expect(store.get('same', 'plugin')?.version).toBe('1.0.0');
    expect(store.get('same', 'mcp')?.version).toBe('2.0.0');
    expect(store.snapshot().schemaVersion).toBe(3);

    const plan = createRuntimeInstallPlan({ id: 'server', type: 'mcp', version: '1.0.0', source: 'owner/server' });
    expect(plan.argv.slice(0, 3)).toEqual(['runtime/cli.mjs', 'mcp', 'install']);
    expect(plan.reason).toContain('Runtime Platform V3');

    expect(resolvePackageDependencies([
      { id: 'core', type: 'plugin' },
      { id: 'server', type: 'mcp', dependencies: ['core'] },
      { id: 'worker', type: 'agent', dependencies: [{ type: 'mcp', id: 'server' }] },
    ], { type: 'agent', id: 'worker' })).toEqual(['plugin:core', 'mcp:server', 'agent:worker']);

    expect(bindRuntime({ id: 'server', type: 'mcp', version: '1.0.0', target: '/runtime/server' }, true)).toMatchObject({
      bound: true,
      runtime: 'dsh-runtime-v3',
      packageKey: 'mcp:server',
    });
  });
});
