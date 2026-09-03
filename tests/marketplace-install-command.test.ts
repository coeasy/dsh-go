import { describe, expect, it } from 'vitest';
import { I18N } from '../site/src/i18n/dict';
import { SUPPORTED_LANGS } from '../site/src/i18n/config';

describe('marketplace install command wording', () => {
  it('uses dsh plugin install in every supported locale', () => {
    for (const lang of SUPPORTED_LANGS) {
      expect(I18N[lang].guide_s3, lang).toContain('dsh plugin install');
      expect(I18N[lang].guide_s3, lang).not.toContain('dsh plugin add');
    }
  });
});
