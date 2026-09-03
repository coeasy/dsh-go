import { describe, expect, it } from 'vitest';
import { I18N } from '../site/src/i18n/dict';

describe('marketplace install command wording', () => {
  it('uses dsh plugin install in every current locale', () => {
    expect(I18N.zh.guide_s3).toContain('dsh plugin install');
    expect(I18N.en.guide_s3).toContain('dsh plugin install');
    expect(I18N.zh.guide_s3).not.toContain('dsh plugin add');
    expect(I18N.en.guide_s3).not.toContain('dsh plugin add');
  });
});
