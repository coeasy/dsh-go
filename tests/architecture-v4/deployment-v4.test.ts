import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRegistryUrl, expectedRegistryState, registryMatches } from '../../scripts/check-deployment-convergence.mjs';

const root = process.cwd();
const text = (path: string) => readFileSync(join(root, path), 'utf8');

describe('Deployment V4 contract', () => {
  it('converges on exact Registry V4 revision instead of legacy counts', () => {
    const registry = { schema_version: 4, revision: 'a'.repeat(64), packages: [{ releases: [{ version: '1.0.0' }] }, { releases: [] }] };
    const expected = expectedRegistryState(registry);
    expect(expected).toEqual({ schema: 4, revision: 'a'.repeat(64), packages: 2, releases: 1 });
    expect(registryMatches(expected, registry)).toBe(true);
    expect(registryMatches(expected, { ...registry, revision: 'b'.repeat(64) })).toBe(false);
    expect(buildRegistryUrl('https://example.test/base/?token=x').toString()).toBe('https://example.test/base/catalog/registry-v4.json?token=x');
  });

  it('ships a fail-closed deploy gate for Protocol V2 / API V2 / Registry V4', () => {
    const gate = text('scripts/deploy-gate-v4.mjs');
    expect(gate).toContain('MAX_PUBLIC_REGISTRY_BYTES');
    expect(gate).toContain('registry-v4.json');
    expect(gate).toContain('registry-v4/index.json');
    expect(gate).toContain('search-index-v3.json');
    expect(gate).toContain("discovery.protocol?.version !== 2");
    expect(gate).toContain("discovery.api?.version !== 'v2'");
    expect(gate).toContain('discovery.registry?.version !== 4');
    expect(gate).toContain("Object.keys(openapi.paths || {}).some((path) => !path.startsWith('/api/v2'))");
  });
});
