export const SUPPORTED_LANGS = ['en', 'zh-CN', 'ja', 'ko', 'es'] as const;
export type Lang = typeof SUPPORTED_LANGS[number];

export const DEFAULT_LANG: Lang = 'en';

export const LANGUAGE_LABELS: Record<Lang, string> = {
  en: 'English',
  'zh-CN': '简体中文',
  ja: '日本語',
  ko: '한국어',
  es: 'Español',
};

export function normalizeLang(value: unknown): Lang | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const exact = SUPPORTED_LANGS.find((lang) => lang.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const base = raw.toLowerCase().split(/[-_]/)[0];
  if (base === 'zh') return 'zh-CN';
  if (base === 'en') return 'en';
  if (base === 'ja') return 'ja';
  if (base === 'ko') return 'ko';
  if (base === 'es') return 'es';
  return null;
}
