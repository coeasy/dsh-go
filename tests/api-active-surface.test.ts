import { describe, expect, it } from 'vitest';
import { onRequestGet as getCategories } from '../functions/api/v1/categories';
import { onRequestGet as getStats } from '../functions/api/v1/stats';
import { onRequestGet as getPlugin } from '../functions/api/v1/plugins/[slug]';
import { onRequestPost as postMcp } from '../functions/api/v1/mcp';

const catalog = {
  version: 2,
  meta: {
    etag: 'active-surface', count: 3, updated_at: '2026-08-25T00:00:00Z',
    stats: { total: 3, verified: 0, by_category: { tool: 3 }, by_language: {}, by_license: {} },
  },
  plugins: [
    { slug: 'owner-active', name: 'active', full_name: 'owner/active', description: 'active plugin', category: 'tool', topics: [], tags: [], stars: 1, forks: 0, open_issues: 0, created_at: '', updated_at: '', first_seen: '', trend_score: 1, language: '', license: '', install_cmd: 'x', repo_url: 'https://github.com/owner/active', homepage: null, verified: false, has_readme: false, readme_excerpt: '' },
    { slug: 'owner-archived', name: 'archived', full_name: 'owner/archived', description: 'archived plugin', category: 'tool', topics: [], tags: [], stars: 100, forks: 0, open_issues: 0, created_at: '', updated_at: '', first_seen: '', trend_score: 100, language: '', license: '', install_cmd: 'x', repo_url: 'https://github.com/owner/archived', homepage: null, verified: false, has_readme: false, readme_excerpt: '', deprecated: true },
    { slug: 'owner-disabled', name: 'disabled', full_name: 'owner/disabled', description: 'disabled plugin', category: 'tool', topics: [], tags: [], stars: 200, forks: 0, open_issues: 0, created_at: '', updated_at: '', first_seen: '', trend_score: 200, language: '', license: '', install_cmd: 'x', repo_url: 'https://github.com/owner/disabled', homepage: null, verified: false, has_readme: false, readme_excerpt: '', disabled: true },
  ],
};
const env: any = { ASSETS: { fetch: async () => new Response(JSON.stringify(catalog), { status: 200 }) } };

async function body(response: Response) { return response.json() as Promise<any>; }

describe('active public API surfaces', () => {
  it('returns 404 for inactive detail before considering a matching ETag', async () => {
    const response = await getPlugin({
      request: new Request('https://example.test/api/v1/plugins/owner-archived', { headers: { 'If-None-Match': '"active-surface"' } }),
      env, params: { slug: 'owner-archived' },
    } as any) as Response;
    expect(response.status).toBe(404);
  });

  it('allows explicit historical detail lookup', async () => {
    const response = await getPlugin({
      request: new Request('https://example.test/api/v1/plugins/owner-archived?include_deprecated=true'),
      env, params: { slug: 'OWNER-ARCHIVED' },
    } as any) as Response;
    expect(response.status).toBe(200);
    expect((await body(response)).plugin.full_name).toBe('owner/archived');
  });

  it('categories and stats default to active repositories', async () => {
    const categories = await getCategories({ request: new Request('https://example.test/api/v1/categories'), env } as any) as Response;
    const categoryBody = await body(categories);
    expect(categoryBody.total).toBe(1);
    expect(categoryBody.categories).toEqual([{ id: 'tool', name: 'tool', name_zh: '通用工具', count: 1 }]);

    const stats = await getStats({ request: new Request('https://example.test/api/v1/stats'), env } as any) as Response;
    const statsBody = await body(stats);
    expect(statsBody.stats.total).toBe(1);
    expect(statsBody.top_by_stars.map((x: any) => x.slug)).toEqual(['owner-active']);
  });

  it('MCP get/search/categories do not leak inactive repositories', async () => {
    const call = async (name: string, args: any = {}) => {
      const response = await postMcp({ request: new Request('https://example.test/api/v1/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }), env } as any) as Response;
      const rpc = await body(response);
      return JSON.parse(rpc.result.content[0].text);
    };
    expect(await call('get_plugin', { slug: 'OWNER-ARCHIVED' })).toBeNull();
    expect(await call('search_plugins', { q: 'archived' })).toEqual([]);
    expect(await call('list_categories')).toEqual({ tool: 1 });
  });
});
