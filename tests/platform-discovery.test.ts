import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildDiscoveryUrl,
  validatePlatformDiscovery,
} from '../scripts/check-platform-discovery.mjs';

describe('platform discovery contract', () => {
  it('accepts the checked-in discovery manifest', () => {
    const manifest = JSON.parse(readFileSync(resolve('site/public/.well-known/dsh-marketplace.json'), 'utf8'));
    expect(validatePlatformDiscovery(manifest)).toEqual({ valid: true, errors: [] });
  });

  it('preserves deployment base paths and signed query strings', () => {
    const url = buildDiscoveryUrl('https://coeasy.github.io/dsh-go/?eo_token=secret&eo_time=123#fragment');
    expect(url.pathname).toBe('/dsh-go/.well-known/dsh-marketplace.json');
    expect(url.search).toBe('?eo_token=secret&eo_time=123');
    expect(url.hash).toBe('');
  });

  it('fails closed when a required deployment is removed', () => {
    const manifest = JSON.parse(readFileSync(resolve('site/public/.well-known/dsh-marketplace.json'), 'utf8'));
    manifest.deployments = manifest.deployments.filter((entry: { id: string }) => entry.id !== 'edgeone-pages');
    expect(validatePlatformDiscovery(manifest).errors).toContain('deployments must include edgeone-pages');
  });
});
