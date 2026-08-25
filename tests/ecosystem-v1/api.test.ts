import { describe, expect, it } from 'vitest';
import { ecosystemType, filterEcosystem, toEcosystemItem, type RegistryV3Plugin } from '../../functions/_registry';
import { marketplaceItemFromRegistry } from '../../marketplace/v1/types';

function plugin(type: 'plugin' | 'mcp' | 'skill' | 'agent', id = type): RegistryV3Plugin {
  return {
    id,
    version: '0.1.0',
    source: {
      provider: 'github',
      repo: `owner/${id}`,
      ref: 'main',
      commit: '0123456789abcdef0123456789abcdef01234567',
    },
    artifact: { integrity: `sha256-${'a'.repeat(64)}` },
    runtime: { type, activation: 'restart-required' },
    capabilities: ['plugin', type],
    dependencies: [],
    metadata: { name: `${type} demo`, description: `a ${type}`, verified: true, stars: 10, rank: 1 },
  };
}

describe('Registry V3 ecosystem API contracts', () => {
  it('classifies and filters all supported ecosystem types', () => {
    const registry = [plugin('plugin'), plugin('mcp'), plugin('skill'), plugin('agent')];
    expect(registry.map(ecosystemType)).toEqual(['plugin', 'mcp', 'skill', 'agent']);
    expect(filterEcosystem(registry, { type: 'mcp', verified: true }).map((entry) => entry.id)).toEqual(['mcp']);
    expect(filterEcosystem(registry, { capability: 'SKILL' }).map((entry) => entry.id)).toEqual(['skill']);
  });

  it('returns read-only local install plans and maps Registry metadata verification', () => {
    const entry = plugin('mcp', 'search-mcp');
    const apiItem = toEcosystemItem(entry);
    expect(apiItem.local_install.executed).toBe(false);
    expect(apiItem.local_install.requires_local_runtime).toBe(true);
    const marketplace = marketplaceItemFromRegistry(entry);
    expect(marketplace.verified).toBe(true);
    expect(marketplace.name).toBe('mcp demo');
  });
});
