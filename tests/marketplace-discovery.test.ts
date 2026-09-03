import { describe, expect, it } from 'vitest';
import {
  ecosystemType,
  isDiscoveryAggregator,
  isHomePopular,
  normalizeRepo,
  selectHomeTop100,
} from '../site/src/lib/marketplace';

describe('Marketplace discovery policy', () => {
  it('filters awesome and list-style aggregation repositories from homepage recommendations', () => {
    expect(isDiscoveryAggregator({ name: 'awesome-dsh', full_name: 'demo/awesome-dsh' })).toBe(true);
    expect(isDiscoveryAggregator({ name: 'dsh-awesome-tools', full_name: 'demo/dsh-awesome-tools' })).toBe(true);
    expect(isDiscoveryAggregator({ name: 'MCP directory', full_name: 'demo/mcp-directory' })).toBe(true);
    expect(isDiscoveryAggregator({ name: 'Useful project', full_name: 'demo/useful-project', description: 'A curated list of MCP servers' })).toBe(true);
  });

  it('does not reject normal packages just because they use directory or resource concepts', () => {
    expect(isDiscoveryAggregator({ name: 'directory-sync', full_name: 'demo/directory-sync' })).toBe(false);
    expect(isDiscoveryAggregator({ name: 'resource-cache', full_name: 'demo/resource-cache' })).toBe(false);
    expect(isDiscoveryAggregator({ name: 'collection-manager', full_name: 'demo/collection-manager' })).toBe(false);
  });

  it('keeps inactive packages out while preserving the star band and aggregator policy', () => {
    const plugins = [
      { name: 'direct-plugin', full_name: 'demo/direct-plugin', stars: 900, verified: true },
      { name: 'disabled-plugin', full_name: 'demo/disabled-plugin', stars: 1000, disabled: true },
      { name: 'deprecated-plugin', full_name: 'demo/deprecated-plugin', stars: 1100, deprecated: true },
      { name: 'awesome-plugins', full_name: 'demo/awesome-plugins', stars: 1500 },
      { name: 'too-small', full_name: 'demo/too-small', stars: 99 },
      { name: 'too-large', full_name: 'demo/too-large', stars: 5001 },
    ];

    expect(isHomePopular(plugins[0])).toBe(true);
    expect(selectHomeTop100(plugins).map((plugin) => plugin.name)).toEqual(['direct-plugin']);
  });

  it('preserves Registry type inference and repository normalization contracts', () => {
    expect(ecosystemType({ id: 'runtime-mcp', runtime: { type: 'mcp' } })).toBe('mcp');
    expect(ecosystemType({ id: 'capability-skill', capabilities: ['skill'] })).toBe('skill');
    expect(ecosystemType({ id: 'legacy-mcp', kind: 'mcp-server' })).toBe('mcp');
    expect(normalizeRepo('https://github.com/Demo/Tool.git')).toBe('demo/tool');
    expect(normalizeRepo('git@github.com:Demo/Tool.git')).toBe('demo/tool');
  });
});
