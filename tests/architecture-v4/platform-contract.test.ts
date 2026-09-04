import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const text = (path: string) => readFileSync(join(root, path), 'utf8');

describe('Breaking architecture contract', () => {
  it('has no public API V1 implementation', () => {
    expect(existsSync(join(root, 'functions/api/v1'))).toBe(false);
    expect(text('site/public/openapi.json')).not.toContain('/api/v1');
    expect(text('site/public/.well-known/dsh-marketplace.json')).not.toContain('/api/v1');
  });

  it('publishes Protocol V2 / Registry V4 / Distribution V2 / Search V3', () => {
    const discovery = JSON.parse(text('site/public/.well-known/dsh-marketplace.json'));
    expect(discovery.schema).toBe('dsh-marketplace-discovery.v2');
    expect(discovery.protocol.version).toBe(2);
    expect(discovery.registry.version).toBe(4);
    expect(discovery.registry.distribution.version).toBe(2);
    expect(discovery.registry.search_index.version).toBe(3);
    expect(discovery.installation.remote_mutation).toBe(false);
    expect(discovery.installation.deep_link_registry_override).toBe(false);
    expect(discovery.installation.auto_restart).toBe(false);
  });

  it('uses one resolver for remote and local package planning', () => {
    expect(text('functions/api/v2/resolve.ts')).toContain("from '../../../packages/resolver/index.mjs'");
    expect(text('functions/api/v2/install-plan.ts')).toContain("from '../../../packages/resolver/index.mjs'");
    expect(text('runtime/package-service.mjs')).toContain("from '../packages/resolver/index.mjs'");
  });

  it('uses only canonical Marketplace V2 discovery and package routes', () => {
    expect(text('site/src/pages/index.astro')).toContain("MarketplaceV2");
    expect(text('site/src/components/MarketplaceV2.astro')).toContain('/catalog/search-index-v3.json');
    expect(text('site/src/components/MarketplaceV2.astro')).toContain('dsh://package/install?');
    expect(text('site/src/components/MarketplaceV2.astro')).toContain('dsh package install');
    expect(existsSync(join(root, 'site/src/pages/plugin'))).toBe(false);
    expect(existsSync(join(root, 'site/src/pages/ecosystem/[id].astro'))).toBe(false);
    expect(existsSync(join(root, 'site/src/components/UnifiedMarketplace.astro'))).toBe(false);
  });

  it('uses one i18n message source and removes runtime text walkers', () => {
    expect(text('site/src/scripts/i18n.ts')).toContain("from '../i18n/messages'");
    expect(text('site/src/scripts/i18n.ts')).not.toContain('legacy-page-text');
    expect(existsSync(join(root, 'site/src/i18n/legacy-page-text.ts'))).toBe(false);
    expect(existsSync(join(root, 'site/src/scripts/marketplace-i18n.ts'))).toBe(false);
  });

  it('defines cryptographic trust without conflating popularity or digest presence', () => {
    const trust = text('site/src/pages/trust.astro');
    expect(trust).toContain('cryptographic_signature_verified');
    expect(trust).toContain("publisherVerified && cryptoVerified ? 'trusted'");
    expect(trust).toContain('popularity');
    expect(trust).toContain('Digest equality confirms bytes, not signer identity');
  });
});
