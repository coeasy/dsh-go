import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('public OpenAPI ecosystem contract', () => {
  it('documents Registry V3 ecosystem and read-only MCP install planning', async () => {
    const spec = JSON.parse(await readFile('site/public/openapi.json', 'utf8'));
    expect(spec.paths['/api/v1/ecosystem']).toBeTruthy();
    expect(spec.paths['/api/v1/ecosystem/{id}']).toBeTruthy();
    expect(spec.paths['/api/v1/registry']).toBeTruthy();
    expect(spec.paths['/api/v1/mcp'].post.description).toContain('plan_local_install');
    expect(spec.components.schemas.EcosystemItem.properties.local_install.properties.executed.enum).toEqual([false]);
  });
});
