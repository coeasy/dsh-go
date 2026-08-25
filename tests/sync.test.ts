import { describe, it, expect } from 'vitest';

// 顶层动态 import 走 Node 原生 ESM 加载，避免 vitest 对 .mjs 的 transform 兼容问题
const { dedupeTags, computeTrendScore, isAuthoritativeManifestFile } = await import('../scripts/sync.mjs');

describe('manifest authority', () => {
  it('只有 dsh-plugin.json 能作为 DSH manifest', () => {
    expect(isAuthoritativeManifestFile('dsh-plugin.json')).toBe(true);
    expect(isAuthoritativeManifestFile('package.json')).toBe(false);
    expect(isAuthoritativeManifestFile('plugin.json')).toBe(false);
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
