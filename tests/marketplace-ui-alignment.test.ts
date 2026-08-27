import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PACKAGE_VERSION,
  HOME_TOP_LIMIT,
  POPULAR_STARS_MAX,
  POPULAR_STARS_MIN,
  alignRegistryItem,
  buildLegacyRepoIndex,
  findRegistryMatchForLegacy,
  normalizeRepoKey,
  selectHomeTop100,
} from '../site/src/lib/marketplace';

describe('marketplace UI alignment policy', () => {
  it('keeps homepage Top100 inside the 100-5000 star band and excludes >10k', () => {
    const candidates = [
      { name: 'too-small', stars: 99 },
      { name: 'lower-bound', stars: 100 },
      { name: 'normal', stars: 250 },
      { name: 'upper-bound', stars: 5000 },
      { name: 'too-large', stars: 5001 },
      { name: 'mega', stars: 10001 },
      ...Array.from({ length: 120 }, (_, index) => ({ name: `repo-${index}`, stars: 100 + index })),
    ];

    const selected = selectHomeTop100(candidates);
    expect(POPULAR_STARS_MIN).toBe(100);
    expect(POPULAR_STARS_MAX).toBe(5000);
    expect(HOME_TOP_LIMIT).toBe(100);
    expect(selected).toHaveLength(100);
    expect(selected.every((item) => item.stars >= 100 && item.stars <= 5000)).toBe(true);
    expect(selected.some((item) => item.name === 'mega')).toBe(false);
    expect(selected.some((item) => item.name === 'too-large')).toBe(false);
    expect(selected[0].stars).toBeGreaterThanOrEqual(selected.at(-1)?.stars || 0);
  });

  it('normalizes GitHub repository identity before matching catalogs', () => {
    expect(normalizeRepoKey('https://github.com/Owner/Repo.git')).toBe('owner/repo');
    expect(normalizeRepoKey('github:Owner/Repo')).toBe('owner/repo');
    expect(normalizeRepoKey('Owner/Repo/')).toBe('owner/repo');
  });

  it('uses Registry version/runtime while overlaying original dsh-plugin display metadata by repository', () => {
    const legacy = {
      id: 'legacy-id',
      slug: 'owner-repo',
      full_name: 'Owner/Repo',
      name: 'Repository Display Name',
      description: 'fresh catalog description',
      stars: 880,
      category: 'mcp',
      language: 'TypeScript',
      topics: ['mcp', 'tools'],
      updated_at: '2026-08-27T00:00:00Z',
    };
    const registry = {
      id: 'runtime-id',
      version: DEFAULT_PACKAGE_VERSION,
      source: { repo: 'owner/repo', commit: '0123456789abcdef0123456789abcdef01234567' },
      runtime: { type: 'mcp' },
      capabilities: ['plugin', 'mcp'],
      dependencies: [],
      metadata: { name: 'stale name', description: 'stale description', stars: 12 },
    };

    const aligned = alignRegistryItem(registry, buildLegacyRepoIndex([legacy]));
    expect(aligned.id).toBe('runtime-id');
    expect(aligned.type).toBe('mcp');
    expect(aligned.version).toBe('0.1.0');
    expect(aligned.name).toBe('Repository Display Name');
    expect(aligned.description).toBe('fresh catalog description');
    expect(aligned.stars).toBe(880);
    expect(aligned.language).toBe('TypeScript');
    expect(aligned.installCommand).toBe('dsh mcp install runtime-id@0.1.0');
  });

  it('does not bind an id fallback to a conflicting repository', () => {
    const registryItems = [
      { id: 'shared-id', source: { repo: 'other/project' } },
      { id: 'another-id', source: { repo: 'owner/right-project' } },
    ];
    const legacy = { id: 'shared-id', full_name: 'owner/right-project' };
    const match = findRegistryMatchForLegacy(legacy, registryItems);
    expect(match?.id).toBe('another-id');
    expect(match?.source?.repo).toBe('owner/right-project');
  });

  it('keeps the 100-star detail threshold synchronized with generated install assets', () => {
    const thresholdSource = readFileSync(resolve('site/src/lib/threshold.ts'), 'utf8');
    const assetSource = readFileSync(resolve('scripts/copy-assets-core.mjs'), 'utf8');
    expect(thresholdSource).toContain('DETAIL_THRESHOLD = 100');
    expect(assetSource).toContain('DETAIL_THRESHOLD = 100');
  });

  it('keeps both marketplaces wired to the shared alignment policy and card', () => {
    const homepage = readFileSync(resolve('site/src/pages/index.astro'), 'utf8');
    const ecosystem = readFileSync(resolve('site/src/pages/ecosystem.astro'), 'utf8');
    const pluginDetail = readFileSync(resolve('site/src/pages/plugin/[slug].astro'), 'utf8');
    const ecosystemDetail = readFileSync(resolve('site/src/pages/ecosystem/[id].astro'), 'utf8');
    expect(homepage).toContain('selectHomeTop100');
    expect(ecosystem).toContain('alignRegistryItem');
    expect(ecosystem).toContain('variant="ecosystem"');
    expect(pluginDetail).toContain('MarketplaceDetailHero');
    expect(ecosystemDetail).toContain('MarketplaceDetailHero');
  });
});
