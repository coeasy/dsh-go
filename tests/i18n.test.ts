import { describe, it, expect } from 'vitest';
import { I18N, CAT, tr, type Lang } from '../site/src/i18n/dict';

describe('i18n dictionary', () => {
  const zhKeys = Object.keys(I18N.zh).sort();
  const enKeys = Object.keys(I18N.en).sort();

  it('zh 与 en 键集合完全一致', () => {
    expect(zhKeys).toEqual(enKeys);
  });

  it('所有分类映射键在双语表中均存在', () => {
    for (const key of Object.values(CAT)) {
      expect(I18N.zh[key], `zh missing ${key}`).toBeDefined();
      expect(I18N.en[key], `en missing ${key}`).toBeDefined();
    }
  });

  it('所有带占位符的模板在两种语言都含相同占位符', () => {
    const ph = (s: string) => (s.match(/\{(\w+)\}/g) || []).sort().join(',');
    for (const k of zhKeys) {
      expect(ph(I18N.zh[k]), `占位符不一致: ${k}`).toBe(ph(I18N.en[k]));
    }
  });

  it('tr 插值替换占位符', () => {
    const lang: Lang = 'zh';
    expect(tr('hero_sub', lang, { n: 42 })).toContain('42');
    expect(tr('unknown_key', lang)).toBe('unknown_key');
  });
});
