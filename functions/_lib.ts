// functions/_lib.ts —— API 公共库
// 注意：以下划线开头的文件不会被 Pages 路由，仅作为模块被各端点引用

export interface Plugin {
  slug: string;
  name: string;
  repo_name?: string;
  repo_id?: string | null;
  metadata_source?: 'github' | 'dsh-package' | 'dsh-plugin' | 'dsh-mcp' | 'dsh-skill' | 'dsh-agent' | 'override';
  override_fields?: string[];
  full_name: string;
  description: string;
  category: string;
  topics: string[];
  tags: string[];
  stars: number;
  forks: number;
  open_issues: number;
  created_at: string;
  updated_at: string;
  first_seen: string;
  trend_score: number;
  language: string;
  license: string;
  install_cmd: string;
  repo_url: string;
  homepage: string | null;
  verified: boolean;
  deprecated?: boolean;
  disabled?: boolean;
  has_readme: boolean;
  readme_excerpt: string;
  rank?: number;
}

export interface CatalogData {
  version: number;
  meta: {
    updated_at: string;
    source: string;
    count: number;
    etag: string;
    stats: {
      total: number;
      verified: number;
      by_category: Record<string, number>;
      by_language: Record<string, number>;
      by_license: Record<string, number>;
    };
    distribution?: {
      version: number;
      index_path: string;
      primary?: boolean;
    };
  };
  plugins: Plugin[];
}

interface CatalogDistributionIndex {
  format: string;
  distribution_version: number;
  catalog_version: number;
  etag: string;
  count: number;
  meta: CatalogData['meta'];
  shards: Array<{ path: string; category: string; count: number; bytes: number; content_hash: string }>;
}

interface CatalogShard {
  format: string;
  distribution_version: number;
  category: string;
  count: number;
  plugins: Array<Partial<Plugin> & { full_name?: string; tags?: string[] }>;
}

const CACHE_TTL_MS = 120_000;
const MAX_RUNTIME_CATALOG_SHARDS = 32;
const cache = new Map<string, { data: CatalogData; etag: string; source: 'static'; expires_at: number }>();

/** Cloudflare Pages 运行环境绑定（免费版：仅 ASSETS 静态资源绑定） */
export interface Env {
  ASSETS: {
    fetch: (input: Request | string | URL, init?: RequestInit) => Promise<Response>;
  };
}

export interface CatalogResult {
  data: CatalogData;
  etag: string;
  source: 'static';
}

const ASSET_BASE = 'https://dsh-go.pages.dev';
const CATALOG_DISTRIBUTION_INDEX = '/catalog/catalog-v3/index.json';
const LEGACY_CATALOG = '/catalog/plugins.json';
const CATALOG_CACHE_URL = 'https://dsh-go.pages.dev/__dsh/cache/catalog-v3.json';

function sharedCache(): Cache | undefined {
  if (typeof caches === 'undefined') return undefined;
  return (caches as CacheStorage & { default?: Cache }).default;
}

function repoName(fullName: string) {
  const parts = String(fullName || '').split('/');
  return parts.length === 2 ? parts[1] : '';
}

function installProfile(category: string) {
  if (category === 'web-ui') return 'web';
  if (category === 'desktop') return 'desktop';
  return 'tools';
}

function hydratePlugin(raw: Partial<Plugin> & { full_name?: string; tags?: string[] }): Plugin {
  const fullName = String(raw.full_name || '');
  const category = String(raw.category || 'other');
  const tags = Array.isArray(raw.tags) ? raw.tags.map(String) : [];
  const topics = Array.isArray(raw.topics) ? raw.topics.map(String) : tags;
  return {
    ...raw,
    slug: String(raw.slug || fullName.replace('/', '-')),
    name: String(raw.name || repoName(fullName) || fullName),
    repo_name: String(raw.repo_name || repoName(fullName)),
    full_name: fullName,
    description: String(raw.description || ''),
    category,
    topics,
    tags,
    stars: Number(raw.stars || 0),
    forks: Number(raw.forks || 0),
    open_issues: Number(raw.open_issues || 0),
    created_at: String(raw.created_at || ''),
    updated_at: String(raw.updated_at || ''),
    first_seen: String(raw.first_seen || ''),
    trend_score: Number(raw.trend_score || 0),
    language: String(raw.language || ''),
    license: String(raw.license || ''),
    install_cmd: String(raw.install_cmd || `dsh plugin --profile ${installProfile(category)} add github:${fullName}`),
    repo_url: String(raw.repo_url || (fullName ? `https://github.com/${fullName}` : '')),
    homepage: raw.homepage || null,
    verified: raw.verified === true,
    deprecated: raw.deprecated === true,
    disabled: raw.disabled === true,
    has_readme: raw.has_readme === true,
    readme_excerpt: String(raw.readme_excerpt || ''),
  };
}

async function loadDistribution(env: Env): Promise<CatalogResult | null> {
  const indexResponse = await env.ASSETS.fetch(new URL(CATALOG_DISTRIBUTION_INDEX, ASSET_BASE));
  if (indexResponse.status === 404) return null;
  if (!indexResponse.ok) throw new Error(`catalog distribution index load failed: ${indexResponse.status}`);
  const index = (await indexResponse.json()) as CatalogDistributionIndex & Partial<CatalogData>;
  // Test fixtures and some static hosts may route an unknown JSON path to the legacy
  // catalog. Treat that recognizable payload as an intentional compatibility fallback.
  if (index.format !== 'dsh-catalog-distribution' && Array.isArray(index.plugins) && index.meta) return null;
  if (index.format !== 'dsh-catalog-distribution' || index.distribution_version !== 1 || !Array.isArray(index.shards)) {
    throw new Error('catalog distribution index contract invalid');
  }
  // Cloudflare Pages Functions have a finite subrequest budget. Prefer bounded shards
  // while the distribution fits comfortably; otherwise fall back to the compact aggregate.
  if (index.shards.length > MAX_RUNTIME_CATALOG_SHARDS) return null;

  const shardPlugins = await Promise.all(index.shards.map(async (descriptor) => {
    const response = await env.ASSETS.fetch(new URL(`/catalog/catalog-v3/${descriptor.path}`, ASSET_BASE));
    if (!response.ok) throw new Error(`catalog shard load failed: ${descriptor.path} (${response.status})`);
    const shard = (await response.json()) as CatalogShard;
    if (shard.format !== index.format || shard.distribution_version !== index.distribution_version || !Array.isArray(shard.plugins)) {
      throw new Error(`catalog shard contract invalid: ${descriptor.path}`);
    }
    if (shard.count !== shard.plugins.length || descriptor.count !== shard.plugins.length) {
      throw new Error(`catalog shard count mismatch: ${descriptor.path}`);
    }
    return shard.plugins;
  }));

  const plugins = shardPlugins.flat().map(hydratePlugin);
  if (plugins.length !== Number(index.count || 0)) throw new Error(`catalog distribution count mismatch: index=${index.count} loaded=${plugins.length}`);
  const data: CatalogData = {
    version: Number(index.catalog_version || 2),
    meta: index.meta,
    plugins,
  };
  return { data, etag: index.etag || data.meta.etag, source: 'static' };
}

async function loadLegacyCatalog(env: Env): Promise<CatalogResult> {
  const res = await env.ASSETS.fetch(new URL(LEGACY_CATALOG, ASSET_BASE));
  if (!res.ok) throw new Error('catalog load failed: ' + res.status);
  const raw = (await res.json()) as CatalogData;
  const data: CatalogData = { ...raw, plugins: (raw.plugins || []).map(hydratePlugin) };
  return { data, etag: data.meta.etag, source: 'static' };
}

/**
 * 读取公开 Catalog Distribution V1。每个静态 shard 都有独立 CDN 缓存并受构建期尺寸门禁约束。
 * 旧版 /catalog/plugins.json 仅作为兼容回退，不再是运行时主数据源。
 */
export async function loadCatalog(env: Env): Promise<CatalogResult> {
  const sc = sharedCache();
  try {
    if (sc) {
      const hit = await sc.match(new Request(CATALOG_CACHE_URL, { method: 'GET' }));
      if (hit) {
        const data = (await hit.json()) as CatalogData;
        return { data, etag: data.meta.etag, source: 'static' };
      }
    }
  } catch { /* Cache API is an optimization; static assets remain authoritative. */ }

  const mem = cache.get('plugins');
  if (mem && mem.expires_at > Date.now()) return { data: mem.data, etag: mem.etag, source: mem.source };

  const result = await loadDistribution(env) || await loadLegacyCatalog(env);
  cache.set('plugins', { ...result, expires_at: Date.now() + CACHE_TTL_MS });

  try {
    if (sc) {
      await sc.put(
        new Request(CATALOG_CACHE_URL, { method: 'GET' }),
        new Response(JSON.stringify(result.data), { headers: { 'Cache-Control': 'public, max-age=120' } })
      );
    }
  } catch { /* ignore cache write failures */ }
  return result;
}

export interface Query {
  category?: string;
  verified?: boolean;
  language?: string;
  license?: string;
  search?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  page?: number;
  per_page?: number;
  created_after?: string;
  updated_after?: string;
  include_deprecated?: boolean;
}

export function parseQuery(url: URL): Query {
  const g = (k: string) => url.searchParams.get(k) || undefined;
  return {
    category: g('category'),
    verified: g('verified') === 'true' ? true : g('verified') === 'false' ? false : undefined,
    language: g('language'),
    license: g('license'),
    search: g('search') || g('q'),
    sort: g('sort'),
    order: (() => {
      const raw = g('order');
      return raw === 'asc' || raw === 'desc' ? raw : 'desc';
    })(),
    page: parseInt(g('page') || '1', 10),
    per_page: parseInt(g('per_page') || '50', 10),
    created_after: g('created_after'),
    updated_after: g('updated_after'),
    include_deprecated: g('include_deprecated') === 'true',
  };
}

export function filterPlugins(plugins: Plugin[], q: Query): Plugin[] {
  let list = plugins;
  if (!q.include_deprecated) list = list.filter((p) => !p.deprecated && !p.disabled);
  if (q.category && q.category !== 'all') {
    list = list.filter((p) => p.category === q.category);
  }
  if (q.verified !== undefined) list = list.filter((p) => p.verified === q.verified);
  if (q.language) list = list.filter((p) => p.language?.toLowerCase() === q.language!.toLowerCase());
  if (q.license) list = list.filter((p) => p.license?.toLowerCase() === q.license!.toLowerCase());
  if (q.created_after) list = list.filter((p) => p.created_at >= q.created_after!);
  if (q.updated_after) list = list.filter((p) => p.updated_at >= q.updated_after!);
  if (q.search) {
    const kw = q.search.toLowerCase();
    list = list.filter(
      (p) =>
        String(p.name || '').toLowerCase().includes(kw) ||
        String(p.full_name || '').toLowerCase().includes(kw) ||
        String(p.repo_name || '').toLowerCase().includes(kw) ||
        String(p.description || '').toLowerCase().includes(kw) ||
        (p.topics || []).some((t) => t.toLowerCase().includes(kw)) ||
        (p.tags || []).some((t) => t.toLowerCase().includes(kw))
    );
  }
  const sorters: Record<string, (a: Plugin, b: Plugin) => number> = {
    stars: (a, b) => b.stars - a.stars,
    trend: (a, b) => b.trend_score - a.trend_score,
    updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
    created: (a, b) => b.created_at.localeCompare(a.created_at),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  const sorter = sorters[q.sort || 'stars'] || sorters.stars;
  if (sorter) list = [...list].sort(sorter);
  if (q.order === 'asc') list.reverse();
  return list;
}

export function paginate<T>(list: T[], page = 1, perPage = 50) {
  const per = Math.min(Math.max(Number.isFinite(perPage) ? perPage : 50, 1), 200);
  const pg = Math.max(Number.isFinite(page) ? page : 1, 1);
  const total = list.length;
  const items = list.slice((pg - 1) * per, pg * per);
  return {
    items,
    pagination: { page: pg, per_page: per, total, total_pages: Math.ceil(total / per) },
  };
}

export function json(body: unknown, init: ResponseInit = {}, etag?: string) {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, If-None-Match, Accept-Language');
  headers.set('Access-Control-Max-Age', '86400');
  headers.set('X-Api-Version', 'v1');
  headers.set('X-Content-Type-Options', 'nosniff');
  if (etag) headers.set('ETag', `"${etag}"`);
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function error(status: number, message: string) {
  return json({ error: { code: status, message } }, { status });
}

/** 500 错误脱敏：记录完整错误给运维，但不向客户端泄漏内部细节（路径/堆栈等） */
export function internalError(e: unknown) {
  console.error('[dsh-go] internal error:', e);
  return error(500, 'internal server error');
}

/** ETag 协商：命中返回 true 时应直接返回 304 */
export function isNotModified(request: Request, etag?: string) {
  if (!etag) return false;
  const inm = request.headers.get('If-None-Match');
  return inm === `"${etag}"` || inm === etag || inm === '*';
}

export function notModifiedResponse(etag: string) {
  return new Response(null, {
    status: 304,
    headers: {
      ETag: `"${etag}"`,
      'Access-Control-Allow-Origin': '*',
      'X-Api-Version': 'v1',
    },
  });
}

export function optionsResponse(methods = 'GET, OPTIONS') {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': methods,
      'Access-Control-Allow-Headers': 'Content-Type, If-None-Match, Accept-Language',
      'Access-Control-Max-Age': '86400',
    },
  });
}
