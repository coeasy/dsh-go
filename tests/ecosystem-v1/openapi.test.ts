import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('public OpenAPI ecosystem contract', () => {
  it('documents Registry V3 ecosystem and read-only MCP install planning', async () => {
    const spec = JSON.parse(await readFile('site/public/openapi.json', 'utf8'));
    expect(spec.info.version).toBe('0.1.0');
    expect(spec.paths['/api/v1/ecosystem']).toBeTruthy();
    expect(spec.paths['/api/v1/ecosystem/{id}']).toBeTruthy();
    expect(spec.paths['/api/v1/registry']).toBeTruthy();
    expect(spec.paths['/api/v1/mcp'].post.description).toContain('plan_local_install');
    expect(spec.components.schemas.EcosystemItem.properties.local_install.properties.executed.enum).toEqual([false]);
  });

  it('documents every public V1 route family exposed by discovery', async () => {
    const spec = JSON.parse(await readFile('site/public/openapi.json', 'utf8'));
    for (const path of [
      '/api/v1',
      '/api/v1/capabilities',
      '/api/v1/plugins',
      '/api/v1/search',
      '/api/v1/categories',
      '/api/v1/stats',
      '/api/v1/ecosystem',
      '/api/v1/registry',
      '/api/v1/registry/delta',
      '/api/v1/registry/packages/{type}/{id}',
      '/api/v1/registry/packages/{type}/{id}/versions',
      '/api/v1/marketplace',
      '/api/v1/package-detail',
      '/api/v1/install-plan',
      '/api/v1/advisories',
      '/api/v1/publishers/{id}',
      '/api/v1/profiles',
      '/api/v1/bundles',
      '/api/v1/providers',
      '/api/v1/providers/{id}',
      '/api/v1/mcp',
      '/api/v1/meta',
      '/api/v1/health',
      '/.well-known/dsh-marketplace.json',
    ]) expect(spec.paths[path], path).toBeTruthy();
  });
});
