import { describe, expect, it } from 'vitest';
import {
  buildRegistryUrl,
  describeRegistryMismatch,
  expectedRegistryState,
  registryMatches,
  safeDisplayUrl,
} from '../scripts/check-deployment-convergence.mjs';

describe('deployment convergence helpers', () => {
  it('builds a Registry URL from a provider root', () => {
    const url = buildRegistryUrl('https://dsh-go.pages.dev');
    expect(url.toString()).toBe('https://dsh-go.pages.dev/catalog/registry-v3.json');
  });

  it('preserves a GitHub Pages base path', () => {
    const url = buildRegistryUrl('https://coeasy.github.io/dsh-go/');
    expect(url.toString()).toBe('https://coeasy.github.io/dsh-go/catalog/registry-v3.json');
  });

  it('preserves EdgeOne signed query credentials without exposing them in display URLs', () => {
    const url = buildRegistryUrl('https://preview.edgeone.app/?eo_token=secret-value');
    expect(url.pathname).toBe('/catalog/registry-v3.json');
    expect(url.searchParams.get('eo_token')).toBe('secret-value');
    expect(safeDisplayUrl(url)).toBe('https://preview.edgeone.app/catalog/registry-v3.json');
  });

  it('requires exact Registry V3 version, content hash, and plugin count', () => {
    const local = {
      registry_version: 3,
      generated: { content_hash: 'sha256:abc' },
      plugins: [{ id: 'one' }, { id: 'two' }],
    };
    const expected = expectedRegistryState(local);

    expect(registryMatches(expected, local)).toBe(true);
    expect(registryMatches(expected, { ...local, registry_version: 2 })).toBe(false);
    expect(registryMatches(expected, { ...local, generated: { content_hash: 'sha256:def' } })).toBe(false);
    expect(registryMatches(expected, { ...local, plugins: [{ id: 'one' }] })).toBe(false);
    expect(describeRegistryMismatch(expected, { ...local, plugins: [] })).toContain('count=0');
  });

  it('rejects malformed local Registry state before any deployment check', () => {
    expect(() => expectedRegistryState({ registry_version: 2, generated: { content_hash: 'x' }, plugins: [] })).toThrow('registry_version=3');
    expect(() => expectedRegistryState({ registry_version: 3, generated: {}, plugins: [] })).toThrow('generated.content_hash');
    expect(() => expectedRegistryState({ registry_version: 3, generated: { content_hash: 'x' } })).toThrow('plugins[]');
  });
});
