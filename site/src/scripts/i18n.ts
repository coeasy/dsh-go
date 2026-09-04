import { CAT, tr } from '../i18n/dict';
import { DEFAULT_LANG, normalizeLang, type Lang } from '../i18n/config';
import { applyLegacyPageText } from '../i18n/legacy-page-text';
import { applyMarketplaceI18n } from './marketplace-i18n';

function saveLang(value: Lang) {
  try { localStorage.setItem('dsh-lang', value); } catch { /* ignore storage failures */ }
}

function routeLang(): Lang | null {
  if (typeof document === 'undefined') return null;
  return normalizeLang(document.documentElement.dataset.routeLocale);
}

export function getLang(): Lang {
  const routed = routeLang();
  if (routed) return routed;
  try {
    const saved = normalizeLang(localStorage.getItem('dsh-lang'));
    if (saved) return saved;
    for (const candidate of navigator.languages || [navigator.language]) {
      const normalized = normalizeLang(candidate);
      if (normalized) return normalized;
    }
  } catch { /* use default below */ }
  return DEFAULT_LANG;
}

export function apply(lang: Lang) {
  document.documentElement.lang = lang;
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    const key = element.getAttribute('data-i18n')!;
    const ctx: Record<string, string> = {};
    if (element.dataset.count != null) ctx.n = element.dataset.count;
    if (element.dataset.base != null) ctx.b = element.dataset.base;
    if (element.dataset.time != null) ctx.t = element.dataset.time;
    if (element.dataset.api != null) ctx.api = element.dataset.api;
    if (element.dataset.apiUrl != null) ctx.api_url = element.dataset.apiUrl;
    if (element.dataset.n != null) ctx.n = element.dataset.n;
    const text = tr(key, lang, ctx);
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) element.setAttribute('placeholder', text);
    else if (text.includes('<')) element.innerHTML = text;
    else element.textContent = text;
  });

  document.querySelectorAll<HTMLElement>('[data-i18n-cat]').forEach((element) => {
    const id = element.getAttribute('data-i18n-cat')!;
    element.textContent = tr(CAT[id] || `cat_${id}`, lang);
  });

  document.querySelectorAll<HTMLElement>('[data-results]').forEach((element) => {
    const count = Number(element.dataset.results || '0');
    element.textContent = tr(count === 1 ? 'results_one' : 'results', lang, { n: count });
  });

  document.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((element) => {
    const text = tr(element.getAttribute('data-i18n-aria')!, lang);
    if (text) element.setAttribute('aria-label', text);
  });

  const selector = document.getElementById('lang-select') as HTMLSelectElement | null;
  if (selector) selector.value = lang;

  const nav = document.querySelector<HTMLElement>('.nav-links');
  if (nav) {
    const path = (nav.dataset.path || '').replace(/\/+$/, '') || '/';
    nav.querySelectorAll<HTMLAnchorElement>('a[data-nav]').forEach((anchor) => {
      const target = (anchor.dataset.nav || '').replace(/\/+$/, '') || '/';
      anchor.classList.toggle('active', target === path);
    });
  }

  applyMarketplaceI18n(lang);
  applyLegacyPageText(lang);
  document.dispatchEvent(new CustomEvent('dsh:languagechange', { detail: { lang } }));
}

let initialized = false;

export function initI18n() {
  const language = getLang();
  apply(language);
  if (!initialized) {
    initialized = true;
    const selector = document.getElementById('lang-select') as HTMLSelectElement | null;
    selector?.addEventListener('change', () => {
      const next = normalizeLang(selector.value) || DEFAULT_LANG;
      saveLang(next);
      apply(next);
    });
  }
  (window as unknown as { __dshI18n: unknown }).__dshI18n = { apply, getLang, tr };
}
