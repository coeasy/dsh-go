import { describe, it, expect } from 'vitest';
import { I18N, CAT, tr } from '../site/src/i18n/dict';
import { SUPPORTED_LANGS, type Lang } from '../site/src/i18n/config';

describe('i18n dictionary', () => {
  const enKeys = Object.keys(I18N.en).sort();

  it('all supported locales expose the exact English key set', () => {
    for (const lang of SUPPORTED_LANGS) expect(Object.keys(I18N[lang]).sort(), lang).toEqual(enKeys);
  });

  it('all category mapping keys exist in every locale', () => {
    for (const lang of SUPPORTED_LANGS) {
      for (const key of Object.values(CAT)) expect(I18N[lang][key], `${lang} missing ${key}`).toBeDefined();
    }
  });

  it('all localized templates preserve English placeholder names', () => {
    const ph = (s: string) => (s.match(/\{(\w+)\}/g) || []).sort().join(',');
    for (const lang of SUPPORTED_LANGS) {
      for (const key of enKeys) expect(ph(I18N[lang][key]), `placeholder mismatch ${lang}:${key}`).toBe(ph(I18N.en[key]));
    }
  });

  it('tr interpolates placeholders and preserves unknown keys', () => {
    const lang: Lang = 'zh-CN';
    expect(tr('hero_sub', lang, { n: 42 })).toContain('42');
    expect(tr('unknown_key', lang)).toBe('unknown_key');
  });
});
