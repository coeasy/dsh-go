import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DETAIL_THRESHOLD } from '../site/src/lib/threshold';

describe('Marketplace detail generation and filtered-card UI contract', () => {
  it('generates detail pages only at 200 stars or above', () => {
    expect(DETAIL_THRESHOLD).toBe(200);

    const pluginDetail = readFileSync(new URL('../site/src/pages/plugin/[slug].astro', import.meta.url), 'utf8');
    expect(pluginDetail).toContain('p.stars >= DETAIL_THRESHOLD');

    const ecosystemDetail = readFileSync(new URL('../site/src/pages/ecosystem/[id].astro', import.meta.url), 'utf8');
    expect(ecosystemDetail).toContain('variant._stars >= DETAIL_THRESHOLD');
  });

  it('does not point low-star discovery cards at non-generated detail routes', () => {
    const marketplace = readFileSync(new URL('../site/src/components/UnifiedMarketplace.astro', import.meta.url), 'utf8');
    expect(marketplace).toContain('stars >= DETAIL_THRESHOLD');
    expect(marketplace).toContain('hasDetail(item)');
    expect(marketplace).toContain('sourceHref(item)');
  });

  it('re-localizes cards after dynamic category/search rendering', () => {
    const marketplace = readFileSync(new URL('../site/src/components/UnifiedMarketplace.astro', import.meta.url), 'utf8');
    const runtime = readFileSync(new URL('../site/src/scripts/marketplace-i18n.ts', import.meta.url), 'utf8');
    expect(marketplace).toContain("new CustomEvent('dsh:marketplacerender')");
    expect(runtime).toContain("document.addEventListener('dsh:marketplacerender'");
    expect(runtime).toContain('localizeCards();');
  });

  it('keeps filtered resource actions anchored to the bottom of equal-height cards', () => {
    const css = readFileSync(new URL('../site/src/styles/marketplace-emphasis.css', import.meta.url), 'utf8');
    expect(css).toContain('grid-template-rows: minmax(0, 1fr) auto');
    expect(css).toContain('max-height:6.8em');
    expect(css).toContain('align-self:end');
  });
});
