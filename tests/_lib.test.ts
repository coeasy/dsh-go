import { describe, it, expect } from 'vitest';
import {
  parseQuery,
  filterPlugins,
  paginate,
  isNotModified,
  json,
  error,
  type Plugin,
  type Query,
} from '../functions/_lib';

function mkPlugin(over: Partial<Plugin> = {}): Plugin {
  return {
    slug: 'owner-repo',
    name: 'Repo',
    full_name: 'owner/repo',
    description: 'A plugin',
    category: 'mcp',
    topics: ['agent'],
    tags: ['ai'],
    stars: 10,
    forks: 1,
    open_issues: 0,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-06-01T00:00:00Z',
    first_seen: '2024-01-01T00:00:00Z',
    trend_score: 30,
    language: 'TypeScript',
    license: 'MIT',
    install_cmd: 'dsh plugin add github:owner/repo',
    repo_url: 'https://github.com/owner/repo',
    homepage: null,
    verified: false,
    has_readme: true,
    readme_excerpt: 'excerpt',
    ...over,
  };
}

describe('parseQuery', () => {
  it('解析标准查询参数', () => {
    const q = parseQuery(new URL('https://x/api/v1/plugins?category=mcp&verified=true&sort=trend&page=2&per_page=10'));
    expect(q.category).toBe('mcp');
    expect(q.verified).toBe(true);
    expect(q.sort).toBe('trend');
    expect(q.page).toBe(2);
    expect(q.per_page).toBe(10);
    expect(q.order).toBe('desc');
  });

  it('verified 为 false 时解析为布尔', () => {
    const q = parseQuery(new URL('https://x?verified=false'));
    expect(q.verified).toBe(false);
  });

  it('order 接受 asc 并限制类型', () => {
    const q = parseQuery(new URL('https://x?order=asc')) as Query;
    expect(q.order).toBe('asc');
  });
});

describe('filterPlugins', () => {
  const list = [
    mkPlugin({ slug: 'a', category: 'mcp', verified: true, stars: 50, trend_score: 5, name: 'Alpha Vision', topics: ['vision'], tags: ['vision'] }),
    mkPlugin({ slug: 'b', category: 'web-ui', verified: false, stars: 100, trend_score: 9, name: 'Beta Tool', topics: ['tool'], tags: [] }),
    mkPlugin({ slug: 'c', category: 'mcp', verified: true, stars: 30, trend_score: 12, name: 'Gamma Agent', description: 'agent framework', topics: ['agent'], tags: ['agent'] }),
  ];

  it('按分类过滤', () => {
    const r = filterPlugins(list, { category: 'mcp' });
    expect(r.map((p) => p.slug)).toEqual(['a', 'c']);
  });

  it('按 verified 过滤', () => {
    const r = filterPlugins(list, { verified: true });
    expect(r.map((p) => p.slug).sort()).toEqual(['a', 'c']);
  });

  it('关键词命中 name / description / topics / tags', () => {
    expect(filterPlugins(list, { search: 'vision' }).map((p) => p.slug)).toEqual(['a']);
    expect(filterPlugins(list, { search: 'agent' }).map((p) => p.slug).sort()).toEqual(['c']);
    expect(filterPlugins(list, { search: 'tool' }).map((p) => p.slug)).toEqual(['b']);
  });

  it('默认按 stars 降序；order=asc 反转', () => {
    const r = filterPlugins(list, {});
    expect(r[0].slug).toBe('b');
    const asc = filterPlugins(list, { order: 'asc' });
    expect(asc[0].slug).toBe('c'); // stars 最小
  });

  it('category=all 不过滤', () => {
    expect(filterPlugins(list, { category: 'all' }).length).toBe(3);
  });
});

describe('paginate', () => {
  const arr = Array.from({ length: 25 }, (_, i) => i);
  it('切片与分页元信息', () => {
    const { items, pagination } = paginate(arr, 1, 10);
    expect(items).toEqual(arr.slice(0, 10));
    expect(pagination.total).toBe(25);
    expect(pagination.total_pages).toBe(3);
  });
  it('超出上限被钳制到 200，下限到 1', () => {
    expect(paginate(arr, 1, 9999).pagination.per_page).toBe(200);
    expect(paginate(arr, -5, 0).pagination.page).toBe(1);
  });
});

describe('isNotModified', () => {
  it('ETag 匹配返回 true', () => {
    const req = new Request('https://x', { headers: { 'If-None-Match': '"abc"' } });
    expect(isNotModified(req, 'abc')).toBe(true);
  });
  it('无 ETag 或不符返回 false', () => {
    const req = new Request('https://x', { headers: { 'If-None-Match': '"xyz"' } });
    expect(isNotModified(req, 'abc')).toBe(false);
    expect(isNotModified(req, undefined)).toBe(false);
  });
});

describe('json / error', () => {
  it('json 设置 CORS 与 ETag 头', () => {
    const r = json({ ok: 1 }, {}, 'v1etag');
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(r.headers.get('ETag')).toBe('"v1etag"');
  });
  it('error 返回状态码与错误体', () => {
    const r = error(404, 'not found');
    expect(r.status).toBe(404);
  });
});
