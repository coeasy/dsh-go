import { describe, expect, it } from 'vitest';
import { I18N } from '../site/src/i18n/dict';
import { DEFAULT_LANG, normalizeLang, SUPPORTED_LANGS } from '../site/src/i18n/config';

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

describe('Marketplace i18n contract', () => {
  it('publishes the canonical first-round language set', () => {
    expect(SUPPORTED_LANGS).toEqual(['en', 'zh-CN', 'ja', 'ko', 'es']);
    expect(DEFAULT_LANG).toBe('en');
  });

  it('requires every locale to expose the exact English key set', () => {
    const expected = Object.keys(I18N.en).sort();
    for (const lang of SUPPORTED_LANGS) {
      expect(Object.keys(I18N[lang]).sort(), lang).toEqual(expected);
      for (const key of expected) expect(I18N[lang][key], `${lang}:${key}`).toBeTruthy();
    }
  });

  it('requires placeholder parity so localization cannot corrupt runtime substitutions', () => {
    for (const lang of SUPPORTED_LANGS) {
      for (const [key, english] of Object.entries(I18N.en)) {
        expect(placeholders(I18N[lang][key]), `${lang}:${key}`).toEqual(placeholders(english));
      }
    }
  });

  it('normalizes browser locale variants without broadening supported machine values', () => {
    expect(normalizeLang('en-US')).toBe('en');
    expect(normalizeLang('zh-TW')).toBe('zh-CN');
    expect(normalizeLang('ja-JP')).toBe('ja');
    expect(normalizeLang('ko-KR')).toBe('ko');
    expect(normalizeLang('es-MX')).toBe('es');
    expect(normalizeLang('fr-FR')).toBeNull();
    expect(normalizeLang('')).toBeNull();
  });
});
