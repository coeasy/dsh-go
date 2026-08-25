import { describe, expect, it } from 'vitest';
import { filterPlugins } from '../functions/_lib';
import { onRequestGet as getEcosystemItem } from '../functions/api/v1/ecosystem/[id]';
import { onRequestPost as postMcp } from '../functions/api/v1/mcp';
import { marketplaceApi } from '../marketplace/v1/api';

const { resolvePlugin } = await import('../runtime/resolver.mjs');

const commit = '0123456789abcdef0123456789abcdef01234567';
const registryPlugin: any = {
  id: 'Owner-Demo', version: '0.1.0',
  source: { provider: 'github', repo: 'owner/demo', ref: 'main', commit },
  artifact: { integrity: 'sha256-' + 'a'.repeat(64) },
  runtime: { type: 'plugin', activation: 'restart-required' },
  capabilities: ['plugin'], dependencies: [], metadata: { name: 'demo', verified: false },
};
const registry: any = {
  registry_version: 3,
  defaults: { plugin_version: '0.1.0' },
  generated: { content_hash: 'registry-etag' },
  plugins: [registryPlugin],
};
const catalog: any = {
  version: 2,
  meta: { etag: 'catalog-etag', count: 2, updated_at: '', stats: { total: 2, verified: 1, by_category: { tool: 2 }, by_language: {}, by_license: {} } },
  plugins: [
    { slug: 'verified', name: 'verified', full_name: 'owner/verified', description: '', category: 'tool', topics: [], tags: [], stars: 2, forks: 0, open_issues: 0, created_at: '', updated_at: '', first_seen: '', trend_score: 2, language: '', license: '', install_cmd: 'x', repo_url: 'https://github.com/owner/verified', homepage: null, verified: true, has_readme: false, readme_excerpt: '' },
    { slug: 'unverified', name: 'unverified', full_name: 'owner/unverified', description: '', category: 'tool', topics: [], tags: [], stars: 1, forks: 0, open_issues: 0, created_at: '', updated_at: '', first_seen: '', trend_score: 1, language: '', license: '', install_cmd: 'x', repo_url: 'https://github.com/owner/unverified', homepage: null, verified: false, has_readme: false, readme_excerpt: '' },
  ],
};

function envForBoth(): any {
  return {
    ASSETS: {
      fetch: async (input: Request | string | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        const body = url.includes('registry-v3.json') ? registry : catalog;
        return new Response(JSON.stringify(body), { status: 200 });
      },
    },
  };
}

async function rpcCall(name: string, args: any) {
  const response = await postMcp({
    request: new Request('https://example.test/api/v1/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }),
    env: envForBoth(),
  } as any) as Response;
  const body: any = await response.json();
  return body.error ?? JSON.parse(body.result.content[0].text);
}

describe('identity consumers', () => {
  it('honors verified=false instead of returning both states', () => {
    expect(filterPlugins(catalog.plugins, { verified: false }).map((p: any) => p.slug)).toEqual(['unverified']);
    expect(filterPlugins(catalog.plugins, { verified: true }).map((p: any) => p.slug)).toEqual(['verified']);
  });

  it('resolves runtime Registry ids case-insensitively', () => {
    expect(resolvePlugin(registry, 'owner-demo').id).toBe('Owner-Demo');
    expect(resolvePlugin(registry, 'OWNER-DEMO').id).toBe('Owner-Demo');
  });

  it('resolves Marketplace ids case-insensitively', async () => {
    const api = marketplaceApi([{ id: 'Owner-Demo', name: 'demo', type: 'plugin', version: '0.1.0', channel: 'stable', source: { type: 'github', url: 'https://github.com/owner/demo' }, capabilities: [], dependencies: [] }]);
    expect((await api.detail('owner-demo'))?.id).toBe('Owner-Demo');
  });

  it('returns 404 for an unknown ecosystem id before ETag handling', async () => {
    const response = await getEcosystemItem({
      request: new Request('https://example.test/api/v1/ecosystem/missing', { headers: { 'If-None-Match': '"registry-etag"' } }),
      env: envForBoth(), params: { id: 'missing' },
    } as any) as Response;
    expect(response.status).toBe(404);
  });

  it('MCP honors verified=false and case-insensitive ecosystem ids', async () => {
    const unverified = await rpcCall('list_plugins', { verified: false });
    expect(unverified.map((p: any) => p.slug)).toEqual(['unverified']);
    const ecosystem = await rpcCall('get_ecosystem_item', { id: 'owner-demo' });
    expect(ecosystem.id).toBe('Owner-Demo');
  });
});
