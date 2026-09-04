import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DETAIL_THRESHOLD } from '../site/src/lib/threshold';
import {
  HOME_HARD_MAX_STARS,
  HOME_MAX_STARS,
  HOME_MIN_STARS,
  HOME_TOP_LIMIT,
} from '../site/src/lib/marketplace';

const policy = JSON.parse(
  readFileSync(new URL('../site/src/config/marketplace-policy.json', import.meta.url), 'utf8'),
);

describe('Marketplace policy single source of truth', () => {
  it('keeps discovery and detail thresholds internally consistent', () => {
    expect(policy.schema_version).toBe(1);
    expect(policy.discovery.home_min_stars).toBeGreaterThanOrEqual(0);
    expect(policy.detail.min_stars).toBe(200);
    expect(policy.discovery.home_min_stars).toBeLessThanOrEqual(policy.detail.min_stars);
    expect(policy.detail.min_stars).toBeLessThanOrEqual(policy.discovery.home_max_stars);
    expect(policy.discovery.home_max_stars).toBeLessThan(policy.discovery.home_hard_max_stars);
    expect(policy.discovery.home_top_limit).toBeGreaterThan(0);
  });

  it('drives all site constants from the shared policy', () => {
    expect(DETAIL_THRESHOLD).toBe(policy.detail.min_stars);
    expect(HOME_MIN_STARS).toBe(policy.discovery.home_min_stars);
    expect(HOME_MAX_STARS).toBe(policy.discovery.home_max_stars);
    expect(HOME_HARD_MAX_STARS).toBe(policy.discovery.home_hard_max_stars);
    expect(HOME_TOP_LIMIT).toBe(policy.discovery.home_top_limit);
  });

  it('keeps generated installer assets aligned with detail-page eligibility', () => {
    expect(policy.generated_install_scripts.min_stars).toBe(policy.detail.min_stars);

    const generator = readFileSync(
      new URL('../scripts/copy-assets-core.mjs', import.meta.url),
      'utf8',
    );
    expect(generator).toContain("site', 'src', 'config', 'marketplace-policy.json");
    expect(generator).toContain('INSTALL_SCRIPT_THRESHOLD');
    expect(generator).not.toContain('const DETAIL_THRESHOLD = 100');
  });
});
