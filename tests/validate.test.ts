import { describe, it, expect } from 'vitest';
import { validateCatalog } from '../scripts/validate.mjs';

function goodCatalog() {
  return {
    version: 2,
    meta: { etag: 'abc', count: 2, updated_at: '2024-01-01T00:00:00Z' },
    plugins: [
      {
        slug: 'a-b',
        full_name: 'a/b',
        repo_name: 'b',
        name: 'b',
        metadata_source: 'dsh-plugin',
        stars: 10,
        verified: true,
        manifest_file: 'dsh-plugin.json',
        category: 'mcp',
        repo_url: 'https://github.com/a/b',
        install_cmd: 'dsh plugin --profile tools add github:a/b',
      },
      {
        slug: 'c-d',
        full_name: 'c/d',
        repo_name: 'd',
        name: 'd',
        metadata_source: 'github',
        stars: 0,
        verified: false,
        manifest_file: null,
        category: 'web-ui',
        repo_url: 'https://github.com/c/d',
        install_cmd: 'dsh plugin --profile web add github:c/d',
      },
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

  it('拒绝把 package.json 当成 manifest 或 verified 来源', () => {
    const c = goodCatalog();
    c.plugins[0].manifest_file = 'package.json';
    expect(validateCatalog(c).errors.some((e) => e.includes('非法 manifest_file'))).toBe(true);
    expect(validateCatalog(c).errors.some((e) => e.includes('verified 必须由 dsh-plugin.json'))).toBe(true);
  });

  it('缺少 canonical install_cmd 直接阻断', () => {
    const c = goodCatalog();
    delete (c.plugins[0] as Record<string, unknown>).install_cmd;
    expect(validateCatalog(c).errors.some((e) => e.includes('install_cmd 与仓库身份不一致'))).toBe(true);
  });

  it('拒绝无字段来源的 legacy override 与危险 homepage', () => {
    const c = goodCatalog();
    c.plugins[1].metadata_source = 'override';
    (c.plugins[1] as Record<string, unknown>).homepage = 'javascript:alert(1)';
    const errors = validateCatalog(c).errors;
    expect(errors.some((e) => e.includes('override 来源缺少字段级来源'))).toBe(true);
    expect(errors.some((e) => e.includes('homepage 非法'))).toBe(true);
  });
});
