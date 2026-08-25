// functions/_lib.ts —— API 公共库
// 注意：以下划线开头的文件不会被 Pages 路由，仅作为模块被各端点引用

export interface Plugin {
  slug: string;
  name: string;
  repo_name?: string;
  repo_id?: string | null;
  metadata_source?: 'github' | 'dsh-plugin' | 'override';
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
  };
  plugins: Plugin[];
}

// 进程级缓存：避免每个请求都重新读静态文件
const cache = new Map<string, { data: CatalogData; etag: string; source: 'static' }>();

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

/**
 * 通过 ASSETS 绑定读取 catalog/plugins.json（静态文件，零成本）
 * 优先使用跨边缘节点共享的 Cache API；不可用时回退到进程级 Map。
 */
const CATALOG_URL = 'https://dsh-go.pages.dev/catalog/plugins.json';

// Cloudflare 提供跨边缘节点共享的 caches.default；@cloudflare/workers-types 旧版未声明该属性，故放宽类型
function sharedCache(): Cache | undefined {
  if (typeof caches === 'undefined') return undefined;
  return (caches as CacheStorage & { default?: Cache }).default;
}

export async function loadCatalog(env: Env): Promise<CatalogResult> {
  // 1) 跨节点缓存（Cloudflare Cache API）
  const sc = sharedCache();
  try {
    if (sc) {
      const key = new Request(CATALOG_URL, { method: 'GET' });
      const hit = await sc.match(key);
      if (hit) {
        const data = (await hit.json()) as CatalogData;
        return { data, etag: data.meta.etag, source: 'static' };
      }
    }
  } catch { /* 忽略，走回退 */ }

  // 2) 进程级缓存（单节点）
  const mem = cache.get('plugins');
  if (mem) return mem;

  // 3) 真正读取静态资源
  const res = await env.ASSETS.fetch(new URL('/catalog/plugins.json', 'https://dsh-go.pages.dev'));
  if (!res.ok) throw new Error('catalog load failed: ' + res.status);

  const data: CatalogData = await res.json();
  const entry = { data, etag: data.meta.etag, source: 'static' as const };

  // 写回跨节点缓存（120 秒：页面上线后 API 快速跟随，避免与静态数据长期不一致）
  try {
    if (sc) {
      await sc.put(
        new Request(CATALOG_URL, { method: 'GET' }),
        new Response(JSON.stringify(data), { headers: { 'Cache-Control': 'public, max-age=120' } })
      );
    }
  } catch { /* 忽略 */ }

  cache.set('plugins', entry);
  return entry;
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
  if (q.category && q.category !== 'all') {
    list = list.filter((p) => p.category === q.category);
  }
  if (q.verified === true) list = list.filter((p) => p.verified);
  if (q.language) list = list.filter((p) => p.language?.toLowerCase() === q.language!.toLowerCase());
  if (q.license) list = list.filter((p) => p.license?.toLowerCase() === q.license!.toLowerCase());
  if (q.created_after) list = list.filter((p) => p.created_at >= q.created_after!);
  if (q.updated_after) list = list.filter((p) => p.updated_at >= q.updated_after!);
  if (q.search) {
    const kw = q.search.toLowerCase();
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(kw) ||
        p.full_name.toLowerCase().includes(kw) ||
        (p.repo_name || '').toLowerCase().includes(kw) ||
        p.description.toLowerCase().includes(kw) ||
        p.topics.some((t) => t.includes(kw)) ||
        p.tags.some((t) => t.includes(kw))
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
  headers.set('Access-Control-Allow-Headers', 'Content-Type, If-None-Match');
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
