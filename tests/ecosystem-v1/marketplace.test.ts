import { describe, expect, it } from 'vitest';
import { MarketplaceInstallAdapter } from '../../marketplace/v1/install-adapter';
import { getPluginVersions } from '../../marketplace/v1/plugin-version-api';
import { MarketplaceSearchEngine } from '../../marketplace/v1/search-engine';
import { marketplaceItemFromRegistry } from '../../marketplace/v1/types';
import { calculateSecurityScore } from '../../marketplace/v1/trust/security-score';
import { validateMarketplaceItem } from '../../marketplace/v1/trust/validator';

function registryItem(version = '0.1.0', channel: 'stable' | 'beta' = 'stable') {
  return marketplaceItemFromRegistry({
    id: 'owner-demo',
    name: 'Demo Tool',
    version,
    channel,
    verified: true,
    description: 'A useful MCP demo',
    source: {
      provider: 'github',
      repo: 'owner/demo',
      ref: 'main',
      commit: '0123456789abcdef0123456789abcdef01234567',
    },
    runtime: { type: 'mcp' },
    capabilities: ['mcp', 'search'],
    dependencies: [],
    artifact: { integrity: `sha256-${'a'.repeat(64)}` },
  });
}

describe('Ecosystem Platform marketplace', () => {
  it('maps Registry V3 records and searches deterministically', () => {
    const stable = registryItem();
    const beta = registryItem('0.2.0', 'beta');
    expect(stable.type).toBe('mcp');
    const results = new MarketplaceSearchEngine().search([beta, stable], {
      keyword: 'demo',
      channel: 'stable',
      capability: 'SEARCH',
    });
    expect(results.map((item) => item.version)).toEqual(['0.1.0']);
  });

  it('enumerates versions and validates immutable supply-chain metadata', () => {
    const stable = registryItem();
    const beta = registryItem('0.2.0', 'beta');
    expect(getPluginVersions('owner-demo', [stable, beta]).map((entry) => entry.version)).toEqual(['0.2.0', '0.1.0']);
    expect(validateMarketplaceItem(stable).allowed).toBe(true);
    expect(calculateSecurityScore(stable).score).toBe(100);
    const unsafe = { ...stable, source: { ...stable.source, commit: undefined } };
    expect(validateMarketplaceItem(unsafe).reasons).toContain('github source must be pinned to an immutable commit');
  });

  it('never reports a remote marketplace install as locally executed', async () => {
    const result = await new MarketplaceInstallAdapter().install({ id: 'owner-demo', version: '0.1.0' });
    expect(result.success).toBe(false);
    expect(result.planned).toBe(true);
    expect(result.executed).toBe(false);
    expect(result.plan.argv).toContain('owner-demo@0.1.0');
  });
});
