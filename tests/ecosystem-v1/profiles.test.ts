import { describe, expect, it } from 'vitest';
import type { MarketplaceItem } from '../../marketplace/v1/types';
import { buildProfileInstallPlan } from '../../profiles/v1/planner';
import { resolveProfile } from '../../profiles/v1/resolver';

function item(id: string, version: string, channel: 'stable' | 'beta' = 'stable'): MarketplaceItem {
  return {
    id,
    name: id,
    type: 'plugin',
    version,
    channel,
    source: { type: 'github', url: `https://github.com/owner/${id}`, commit: '0123456789abcdef0123456789abcdef01234567' },
    capabilities: ['plugin'],
    dependencies: [],
  };
}

describe('Ecosystem Platform profiles and bundles', () => {
  it('resolves exact and latest versions into local runtime plans', () => {
    const registry = [item('a', '0.1.0'), item('a', '0.2.0'), item('b', '0.1.0')];
    const profile = { name: 'dev', version: '0.1.0', items: [{ id: 'a' }, { id: 'b', version: '0.1.0' }] };
    const resolution = resolveProfile(profile, registry);
    expect(resolution.valid).toBe(true);
    expect(resolution.items.find((entry) => entry.id === 'a')?.version).toBe('0.2.0');
    const plan = buildProfileInstallPlan(profile, registry);
    expect(plan.installs).toHaveLength(2);
    expect(plan.installs.every((entry) => entry.requiresLocalRuntime)).toBe(true);
  });

  it('rejects incompatible duplicate requests', () => {
    const registry = [item('a', '0.1.0'), item('a', '0.2.0')];
    const profile = { name: 'bad', version: '0.1.0', items: [{ id: 'a', version: '0.1.0' }, { id: 'a', version: '0.2.0' }] };
    expect(resolveProfile(profile, registry).valid).toBe(false);
  });
});
