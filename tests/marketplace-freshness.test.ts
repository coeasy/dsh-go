import { describe, expect, it } from 'vitest';
import {
  buildRegistryRepoIndex,
  marketplaceScore,
  marketplaceUpdatedAtTimestamp,
  primaryRegistryMatch,
  selectHomeTop100,
} from '../site/src/lib/marketplace';

describe('Marketplace freshness priority', () => {
  it('puts a more recently updated eligible project ahead of an older higher-quality project', () => {
    const older = {
      name: 'older-popular',
      full_name: 'demo/older-popular',
      stars: 5000,
      trend_score: 9999,
      verified: true,
      updated_at: '2026-08-01T00:00:00Z',
    };
    const newer = {
      name: 'newer-project',
      full_name: 'demo/newer-project',
      stars: 100,
      trend_score: 0,
      verified: false,
      updated_at: '2026-09-01T00:00:00Z',
    };

    expect(marketplaceScore(newer)).toBeGreaterThan(marketplaceScore(older));
    expect(selectHomeTop100([older, newer]).map((plugin) => plugin.name)).toEqual([
      'newer-project',
      'older-popular',
    ]);
  });

  it('treats missing or invalid update dates as oldest instead of poisoning the sort', () => {
    expect(marketplaceUpdatedAtTimestamp('')).toBe(0);
    expect(marketplaceUpdatedAtTimestamp('not-a-date')).toBe(0);
    expect(marketplaceUpdatedAtTimestamp('2026-09-01T00:00:00Z')).toBeGreaterThan(0);
  });

  it('selects numeric newer Registry versions instead of lexicographic versions', () => {
    const index = buildRegistryRepoIndex([
      { id: 'tool', version: '1.9.0', kind: 'plugin', source: { repo: 'demo/tool' } },
      { id: 'tool', version: '1.10.0', kind: 'plugin', source: { repo: 'demo/tool' } },
    ]);

    const matches = index.get('demo/tool') || [];
    expect(matches.map((entry) => entry.version)).toEqual(['1.10.0', '1.9.0']);
    expect(primaryRegistryMatch(matches)?.version).toBe('1.10.0');
  });
});
