from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1))


# REST category counts follow the same active/deprecated query semantics as plugin listing.
replace_once(
    'functions/api/v1/categories.ts',
    "import { loadCatalog, json, internalError, type Env } from '../../_lib';",
    "import { loadCatalog, filterPlugins, json, internalError, type Env } from '../../_lib';",
)
replace_once(
    'functions/api/v1/categories.ts',
    "export const onRequestGet: PagesFunction<Env> = async ({ env }) => {\n  try {\n    const { data, etag } = await loadCatalog(env);\n    const byCategory = data.meta.stats.by_category || {};",
    "export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {\n  try {\n    const { data, etag } = await loadCatalog(env);\n    const includeDeprecated = new URL(request.url).searchParams.get('include_deprecated') === 'true';\n    const plugins = filterPlugins(data.plugins, { include_deprecated: includeDeprecated });\n    const byCategory: Record<string, number> = {};\n    for (const plugin of plugins) byCategory[plugin.category || 'other'] = (byCategory[plugin.category || 'other'] || 0) + 1;",
)
replace_once(
    'functions/api/v1/categories.ts',
    "      { categories, total: data.meta.count, meta: { updated_at: data.meta.updated_at } },",
    "      { categories, total: plugins.length, meta: { updated_at: data.meta.updated_at, catalog_total: data.meta.count } },",
)

# Aggregate stats and rankings must not re-introduce inactive repositories.
replace_once(
    'functions/api/v1/stats.ts',
    "import { loadCatalog, json, internalError, type Env } from '../../_lib';",
    "import { loadCatalog, filterPlugins, json, internalError, type Env } from '../../_lib';",
)
replace_once(
    'functions/api/v1/stats.ts',
    "export const onRequestGet: PagesFunction<Env> = async ({ env }) => {\n  try {\n    const { data, etag } = await loadCatalog(env);\n    const plugins = data.plugins;",
    "export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {\n  try {\n    const { data, etag } = await loadCatalog(env);\n    const includeDeprecated = new URL(request.url).searchParams.get('include_deprecated') === 'true';\n    const plugins = filterPlugins(data.plugins, { include_deprecated: includeDeprecated });\n    const byCategory: Record<string, number> = {};\n    const byLanguage: Record<string, number> = {};\n    const byLicense: Record<string, number> = {};\n    let verified = 0;\n    for (const plugin of plugins) {\n      byCategory[plugin.category || 'other'] = (byCategory[plugin.category || 'other'] || 0) + 1;\n      if (plugin.language) byLanguage[plugin.language] = (byLanguage[plugin.language] || 0) + 1;\n      if (plugin.license) byLicense[plugin.license] = (byLicense[plugin.license] || 0) + 1;\n      if (plugin.verified) verified++;\n    }\n    const stats = { total: plugins.length, verified, by_category: byCategory, by_language: byLanguage, by_license: byLicense };",
)
replace_once(
    'functions/api/v1/stats.ts',
    "        stats: data.meta.stats,",
    "        stats,",
)
replace_once(
    'functions/api/v1/stats.ts',
    "        meta: { updated_at: data.meta.updated_at },",
    "        meta: { updated_at: data.meta.updated_at, catalog_total: data.meta.count },",
)

# Detail lookup checks liveness before ETag so a stale/nonexistent slug can never return 304.
replace_once(
    'functions/api/v1/plugins/[slug].ts',
    "import { loadCatalog, json, error, internalError, isNotModified, notModifiedResponse, type Env } from '../../../_lib';",
    "import { loadCatalog, filterPlugins, json, error, internalError, isNotModified, notModifiedResponse, type Env } from '../../../_lib';",
)
replace_once(
    'functions/api/v1/plugins/[slug].ts',
    "    const { data, etag } = await loadCatalog(env);\n\n    if (isNotModified(request, etag)) return notModifiedResponse(etag);\n\n    const plugin = data.plugins.find((p) => p.slug.toLowerCase() === slug);\n    if (!plugin) return error(404, `plugin not found: ${slug}`);\n\n    // 相关插件：同分类的 Top 6\n    const related = data.plugins",
    "    const { data, etag } = await loadCatalog(env);\n    const includeDeprecated = new URL(request.url).searchParams.get('include_deprecated') === 'true';\n    const visiblePlugins = filterPlugins(data.plugins, { include_deprecated: includeDeprecated });\n    const plugin = visiblePlugins.find((p) => p.slug.toLowerCase() === slug);\n    if (!plugin) return error(404, `plugin not found: ${slug}`);\n    if (isNotModified(request, etag)) return notModifiedResponse(etag);\n\n    // 相关插件：同分类的 Top 6\n    const related = visiblePlugins",
)

# Meta preserves the raw catalog count but exposes the active/inactive split explicitly.
replace_once(
    'functions/api/v1/meta.ts',
    "import { loadCatalog, json, internalError, type Env } from '../../_lib';",
    "import { loadCatalog, filterPlugins, json, internalError, type Env } from '../../_lib';",
)
replace_once(
    'functions/api/v1/meta.ts',
    "    const { data, etag } = await loadCatalog(env);\n    let syncMeta: SyncMeta = {};",
    "    const { data, etag } = await loadCatalog(env);\n    const activeCount = filterPlugins(data.plugins, {}).length;\n    let syncMeta: SyncMeta = {};",
)
replace_once(
    'functions/api/v1/meta.ts',
    "      updated_at: data.meta.updated_at, count: data.meta.count, etag, source: 'static',",
    "      updated_at: data.meta.updated_at, count: data.meta.count, active_count: activeCount, inactive_count: data.meta.count - activeCount, etag, source: 'static',",
)

# MCP is a public discovery/install surface too: all tools default to active repositories only.
replace_once(
    'functions/api/v1/mcp.ts',
    "    const { data } = await loadCatalog(env);\n    const plugins = data.plugins;",
    "    const { data } = await loadCatalog(env);\n    const plugins = data.plugins;\n    const activePlugins = filterPlugins(plugins, {});",
)
replace_once(
    'functions/api/v1/mcp.ts',
    "          const p = plugins.find((x) => x.slug === args?.slug);",
    "          const requestedSlug = String(args?.slug || '').toLowerCase();\n          const p = activePlugins.find((x) => x.slug.toLowerCase() === requestedSlug);",
)
replace_once(
    'functions/api/v1/mcp.ts',
    "          result = data.meta.stats.by_category;",
    "          const counts: Record<string, number> = {};\n          for (const plugin of activePlugins) counts[plugin.category || 'other'] = (counts[plugin.category || 'other'] || 0) + 1;\n          result = counts;",
)
replace_once(
    'functions/api/v1/mcp.ts',
    "          const list = plugins\n            .filter((p) =>\n              p.name.toLowerCase().includes(kw) ||\n              p.description.toLowerCase().includes(kw) ||\n              p.topics.some((t) => t.includes(kw)) ||\n              p.full_name.toLowerCase().includes(kw)\n            )\n            .sort((a, b) => b.stars - a.stars)\n            .slice(0, limit);",
    "          const list = filterPlugins(plugins, { search: kw, sort: 'stars' }).slice(0, limit);",
)

# README recommendations must not revive archived/disabled repositories, including pinned ones.
replace_once(
    'scripts/update-readme.mjs',
    "export function pickHot(plugins, { min = DEFAULT_MIN, max = DEFAULT_MAX, top = TOP, pinned = PINNED } = {}) {\n  const byFull = new Map(plugins.map((p) => [String(p.full_name || '').toLowerCase(), p]));",
    "export function pickHot(plugins, { min = DEFAULT_MIN, max = DEFAULT_MAX, top = TOP, pinned = PINNED } = {}) {\n  const activePlugins = plugins.filter((p) => !p.deprecated && !p.disabled);\n  const byFull = new Map(activePlugins.map((p) => [String(p.full_name || '').toLowerCase(), p]));",
)
replace_once(
    'scripts/update-readme.mjs',
    "  const rest = plugins\n    .filter((p) => {",
    "  const rest = activePlugins\n    .filter((p) => {",
)
replace_once(
    'tests/update-readme.test.mjs',
    "  it('buildTable：非空输出表头与行，空列表输出占位', () => {",
    "  it('pickHot：archived/disabled 即使 pinned 也不会重新公开', () => {\n    const archivedPinned = { ...p('liustack/modlens', 3560, '2026-08-24'), deprecated: true };\n    const disabled = { ...p('ysr666/dsh-disabled', 952, '2026-08-24'), disabled: true };\n    const active = p('ccch1mneyyy/dsh-TUI', 2400, '2026-08-23');\n    const hot = pickHot([archivedPinned, disabled, active], { min: 300, max: 5000, top: 10 });\n    expect(hot.map((x) => x.full_name)).toEqual(['ccch1mneyyy/dsh-TUI']);\n  });\n\n  it('buildTable：非空输出表头与行，空列表输出占位', () => {",
)

# Direct API regression coverage catches 304-before-404 and inactive aggregate leaks.
Path('tests/api-active-surface.test.ts').write_text("""import { describe, expect, it } from 'vitest';
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
      request: new Request('https://example.test/api/v1/plugins/owner-archived', { headers: { 'If-None-Match': '\"active-surface\"' } }),
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
""")
