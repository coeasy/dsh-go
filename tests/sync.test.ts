import { describe, it, expect } from 'vitest';

// 顶层动态 import 走 Node 原生 ESM 加载，避免 vitest 对 .mjs 的 transform 兼容问题
const { dedupeTags, computeTrendScore, detectCategory, isAuthoritativeManifestFile, normalizeCategory, restRepositoryState, sanitizeManifest } = await import('../scripts/sync.mjs');

describe('manifest authority', () => {
  it('只有 dsh-plugin.json 能作为 DSH manifest', () => {
    expect(isAuthoritativeManifestFile('dsh-plugin.json')).toBe(true);
    expect(isAuthoritativeManifestFile('package.json')).toBe(false);
    expect(isAuthoritativeManifestFile('plugin.json')).toBe(false);
  });

  it('清洗 manifest 字段并拒绝非法分类', () => {
    expect(normalizeCategory('mcp', 'other')).toBe('mcp');
    expect(normalizeCategory('toString', 'other')).toBe('other');
    expect(sanitizeManifest({ name: ' Brand ', description: ' demo ', category: 'not-real', tags: 'bad' })).toEqual({ name: 'Brand', description: 'demo', tags: [] });
    expect(sanitizeManifest({ name: 'Demo', category: 'skills', tags: [' AI ', 3, '', 'mcp'] })).toEqual({ name: 'Demo', category: 'skills', tags: ['AI', 'mcp'] });
  });
});

describe('category detection', () => {
  it('使用 token 匹配避免 substring 误判', () => {
    expect(detectCategory({ topics: [], description: 'MCP server bridge', name: 'Bridge' }, null)).toBe('mcp');
    expect(detectCategory({ topics: [], description: 'Webhook integration bridge', name: 'Bridge' }, null)).toBe('integration');
    expect(detectCategory({ topics: [], description: 'A codebook formatter', name: 'Codebook' }, null)).toBe('other');
    expect(detectCategory({ topics: ['web-ui'], description: '', name: 'Anything' }, null)).toBe('web-ui');
  });
});

describe('REST repository state', () => {
  it('preserves true watcher counts when search results omit subscribers_count', () => {
    expect(restRepositoryState({ archived: false, disabled: false }, { watchers: 443 })).toEqual({
      watchers: 443, deprecated: false, disabled: false,
    });
    expect(restRepositoryState({ subscribers_count: 12, archived: true, disabled: true }, { watchers: 443 })).toEqual({
      watchers: 12, deprecated: true, disabled: true,
    });
  });

  it('preserves inactive state if a partial REST record omits lifecycle flags', () => {
    expect(restRepositoryState({}, { watchers: 9, deprecated: true, disabled: true })).toEqual({
      watchers: 9, deprecated: true, disabled: true,
    });
  });
});

describe('dedupeTags', () => {
  it('去重、去空、小写化、忽略无效', () => {
    expect(dedupeTags(['AI', 'ai', '', null, ' Agent ', undefined, 'agent'])).toEqual(['ai', 'agent']);
  });
  it('合并 manifest.tags 与 topics 场景', () => {
    const tags = dedupeTags(['vision', 'AI', 'vision', 'ocr']);
    expect(tags).toEqual(['vision', 'ai', 'ocr']);
  });
});

describe('computeTrendScore', () => {
  const now = Date.now();
  const day = 864e5;
  const recent = new Date(now - 2 * day).toISOString();
  const oldUpd = new Date(now - 30 * day).toISOString();
  const freshCreated = new Date(now - 5 * day).toISOString();

  it('近期更新与近期创建加权更高', () => {
    const a = computeTrendScore({ stars: 10, updated_at: recent, created_at: oldUpd } as any);
    const b = computeTrendScore({ stars: 10, updated_at: oldUpd, created_at: oldUpd } as any);
    expect(a).toBeGreaterThan(b);
    expect(a - b).toBe(20); // 仅 updated 加权
  });

  it('近期创建额外 +10', () => {
    const c = computeTrendScore({ stars: 5, updated_at: recent, created_at: freshCreated } as any);
    const d = computeTrendScore({ stars: 5, updated_at: oldUpd, created_at: oldUpd } as any);
    expect(c - d).toBe(30); // 20 updated + 10 created
  });
});
