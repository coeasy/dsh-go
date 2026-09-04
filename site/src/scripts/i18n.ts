import { DEFAULT_LANG, normalizeLang, type Lang } from '../i18n/config';
import { MESSAGES, message, type MessageKey } from '../i18n/messages';

function saveLang(value: Lang) {
  try { localStorage.setItem('dsh-lang', value); } catch { /* storage is optional */ }
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
  } catch { /* default below */ }
  return DEFAULT_LANG;
}

function translateElement(element: HTMLElement, lang: Lang) {
  const key = element.getAttribute('data-msg') as MessageKey | null;
  if (!key || !(key in MESSAGES.en)) return;
  const vars: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(element.dataset)) if (name.startsWith('msgVar') && value != null) vars[name.slice(6).toLowerCase()] = value;
  element.textContent = message(key, lang, vars);
}

export function apply(lang: Lang) {
  document.documentElement.lang = lang;
  document.querySelectorAll<HTMLElement>('[data-msg]').forEach((element) => translateElement(element, lang));
  document.querySelectorAll<HTMLElement>('[data-msg-placeholder]').forEach((element) => {
    const key = element.getAttribute('data-msg-placeholder') as MessageKey | null;
    if (key && key in MESSAGES.en) element.setAttribute('placeholder', message(key, lang));
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
  (window as unknown as { __dshI18n: unknown }).__dshI18n = { apply, getLang, message };
}
