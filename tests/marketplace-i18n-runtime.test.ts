import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MARKETPLACE_I18N_KEYS, marketTr } from '../site/src/i18n/marketplace';
import { SUPPORTED_LANGS } from '../site/src/i18n/config';

describe('marketplace multilingual runtime', () => {
  it('provides the complete marketplace runtime key set for every supported locale', () => {
    expect(MARKETPLACE_I18N_KEYS.length).toBeGreaterThan(40);
    for (const lang of SUPPORTED_LANGS) {
      for (const key of MARKETPLACE_I18N_KEYS) {
        expect(marketTr(key, lang), `${lang}:${key}`).toBeTruthy();
      }
    }
  });

  it('localizes the primary marketplace interaction strings', () => {
    expect(marketTr('market_filter_recommended', 'zh-CN')).toBe('推荐');
    expect(marketTr('market_filter_recommended', 'ja')).toBe('おすすめ');
    expect(marketTr('market_filter_recommended', 'ko')).toBe('추천');
    expect(marketTr('market_filter_recommended', 'es')).toBe('Recomendados');
    expect(marketTr('market_count', 'zh-CN', { n: 12 })).toContain('12');
  });

  it('keeps routed locales authoritative over saved/browser locale selection', () => {
    const source = readFileSync(new URL('../site/src/scripts/i18n.ts', import.meta.url), 'utf8');
    expect(source.indexOf('const routed = routeLang()')).toBeGreaterThanOrEqual(0);
    expect(source.indexOf('if (routed) return routed')).toBeGreaterThan(source.indexOf('const routed = routeLang()'));
    expect(source.indexOf("localStorage.getItem('dsh-lang')")).toBeGreaterThan(source.indexOf('if (routed) return routed'));
  });
});
