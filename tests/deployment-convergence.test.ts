import { describe, expect, it } from 'vitest';
import {
  buildRegistryUrl,
  describeRegistryMismatch,
  expectedRegistryState,
  registryMatches,
  safeDisplayUrl,
} from '../scripts/check-deployment-convergence.mjs';

const REVISION = 'a'.repeat(64);
const registry = (overrides: Record<string, unknown> = {}) => ({
  schema_version: 4,
  revision: REVISION,
  packages: [
    { type: 'plugin', id: 'owner/one', releases: [{ version: '1.0.0' }] },
    { type: 'skill', id: 'owner/two', releases: [{ version: '2.0.0' }, { version: '2.1.0' }] },
  ],
  ...overrides,
});

describe('deployment convergence helpers', () => {
  it('builds a Registry V4 URL from a provider root', () => {
    const url = buildRegistryUrl('https://dsh-go.pages.dev');
    expect(url.toString()).toBe('https://dsh-go.pages.dev/catalog/registry-v4.json');
  });

  it('preserves a GitHub Pages base path', () => {
    const url = buildRegistryUrl('https://coeasy.github.io/dsh-go/');
    expect(url.toString()).toBe('https://coeasy.github.io/dsh-go/catalog/registry-v4.json');
  });

  it('preserves EdgeOne signed query credentials without exposing them in display URLs', () => {
    const url = buildRegistryUrl('https://preview.edgeone.app/?eo_token=secret-value');
    expect(url.pathname).toBe('/catalog/registry-v4.json');
    expect(url.searchParams.get('eo_token')).toBe('secret-value');
    expect(safeDisplayUrl(url)).toBe('https://preview.edgeone.app/catalog/registry-v4.json');
  });

  it('requires exact Registry V4 schema, revision, package count, and release count', () => {
    const local = registry();
    const expected = expectedRegistryState(local);
    expect(expected).toEqual({ schema: 4, revision: REVISION, packages: 2, releases: 3 });
    expect(registryMatches(expected, local)).toBe(true);
    expect(registryMatches(expected, registry({ schema_version: 3 }))).toBe(false);
    expect(registryMatches(expected, registry({ revision: 'b'.repeat(64) }))).toBe(false);
    expect(registryMatches(expected, registry({ packages: [{ type: 'plugin', id: 'owner/one', releases: [] }] }))).toBe(false);
    expect(describeRegistryMismatch(expected, registry({ packages: [] }))).toContain('packages=0');
  });

  it('rejects malformed local Registry V4 state before any deployment check', () => {
    expect(() => expectedRegistryState({ schema_version: 3, revision: REVISION, packages: [] })).toThrow('schema_version=4');
    expect(() => expectedRegistryState({ schema_version: 4, packages: [] })).toThrow('canonical revision');
    expect(() => expectedRegistryState({ schema_version: 4, revision: REVISION })).toThrow('packages[]');
  });
});
