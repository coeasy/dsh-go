import { describe, it, expect } from 'vitest';
import { validateCatalog } from '../scripts/validate.mjs';

function goodCatalog() {
  return {
    version: 2,
    meta: { etag: 'abc', count: 2, updated_at: '2024-01-01T00:00:00Z' },
    plugins: [
      { slug: 'a-b', full_name: 'a/b', stars: 10, verified: true, category: 'mcp', install_cmd: 'x' },
      { slug: 'c-d', full_name: 'c/d', stars: 0, verified: false, category: 'web-ui', install_cmd: 'y' },
    ],
  };
}

describe('validateCatalog', () => {
  it('合法数据无错误', () => {
    const { errors } = validateCatalog(goodCatalog());
    expect(errors).toEqual([]);
  });

  it('version 错误', () => {
    const c = goodCatalog();
    c.version = 1;
    expect(validateCatalog(c).errors).toContain('version 字段必须是 2');
  });

  it('slug 重复', () => {
    const c = goodCatalog();
    c.plugins[1].slug = 'a-b';
    expect(validateCatalog(c).errors.some((e) => e.includes('slug 重复'))).toBe(true);
  });

  it('full_name 非法', () => {
    const c = goodCatalog();
    c.plugins[0].full_name = 'invalid';
    expect(validateCatalog(c).errors.some((e) => e.includes('full_name 非法'))).toBe(true);
  });

  it('stars 非法', () => {
    const c = goodCatalog();
    c.plugins[0].stars = -1;
    expect(validateCatalog(c).errors.some((e) => e.includes('stars 非法'))).toBe(true);
  });

  it('count 与 plugins 长度不一致', () => {
    const c = goodCatalog();
    c.meta.count = 99;
    expect(validateCatalog(c).errors.some((e) => e.includes('meta.count'))).toBe(true);
  });

  it('缺少 install_cmd 产生警告而非错误', () => {
    const c = goodCatalog();
    // 用 Record 断言以允许 delete 可选语义
    delete (c.plugins[0] as Record<string, unknown>).install_cmd;
    const { errors, warns } = validateCatalog(c);
    expect(errors).toEqual([]);
    expect(warns.some((w) => w.includes('install_cmd'))).toBe(true);
  });
});
