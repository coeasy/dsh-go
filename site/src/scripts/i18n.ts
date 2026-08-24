// site/src/scripts/i18n.ts —— 客户端国际化 + 主题切换（由 Layout 以打包 <script> 引入）
import { CAT, tr, type Lang } from '../i18n/dict';

function saveLang(v: Lang) {
  try { localStorage.setItem('dsh-lang', v); } catch { /* ignore */ }
}
function saveTheme(v: string) {
  try { localStorage.setItem('dsh-theme', v); } catch { /* ignore */ }
}

function getLang(): Lang {
  try {
    const s = localStorage.getItem('dsh-lang');
    if (s === 'en' || s === 'zh') return s;
    return navigator.language && navigator.language.toLowerCase().indexOf('en') === 0 ? 'en' : 'zh';
  } catch {
    return 'zh';
  }
}

function apply(lang: Lang) {
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n')!;
    const ctx: Record<string, string> = {};
    if (el.dataset.count != null) ctx.n = el.dataset.count;
    if (el.dataset.base != null) ctx.b = el.dataset.base;
    if (el.dataset.time != null) ctx.t = el.dataset.time;
    if (el.dataset.api != null) ctx.api = el.dataset.api;
    if (el.dataset.apiUrl != null) ctx.api_url = el.dataset.apiUrl;
    if (el.dataset.n != null) ctx.n = el.dataset.n;
    const txt = tr(key, lang, ctx);
    // 输入类元素：设置 placeholder 而非 innerHTML（innerHTML 对 void 元素无效）
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.setAttribute('placeholder', txt);
    }
    // 仅含 HTML（如 footer 内嵌链接）时用 innerHTML，纯文本一律 textContent 防注入
    else if (txt.indexOf('<') !== -1) el.innerHTML = txt;
    else el.textContent = txt;
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-cat]').forEach((el) => {
    const id = el.getAttribute('data-i18n-cat')!;
    const key = CAT[id] || 'cat_' + id;
    el.textContent = tr(key, lang);
  });
  // 结果计数：单复数选择（data-n=1 时用 *_one 词条）
  document.querySelectorAll<HTMLElement>('[data-results]').forEach((el) => {
    const n = Number(el.dataset.results || '0');
    const key = n === 1 ? 'results_one' : 'results';
    el.textContent = tr(key, lang, { n });
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
    const txt = tr(el.getAttribute('data-i18n-aria')!, lang);
    if (txt) el.setAttribute('aria-label', txt);
  });
  // 导航当前页高亮
  const nav = document.querySelector<HTMLElement>('.nav-links');
  if (nav) {
    const path = (nav.dataset.path || '').replace(/\/+$/, '') || '/';
    nav.querySelectorAll<HTMLAnchorElement>('a[data-nav]').forEach((a) => {
      const target = (a.dataset.nav || '').replace(/\/+$/, '') || '/';
      a.classList.toggle('active', target === path);
    });
  }
}

function updateToggles(lang: Lang) {
  const lt = document.getElementById('lang-toggle');
  if (lt) lt.textContent = lang === 'en' ? '中文' : 'EN';
  const dt = document.getElementById('theme-toggle');
  if (dt) dt.textContent = document.documentElement.classList.contains('dark') ? '☀️' : '🌙';
}

function initTheme() {
  let saved: string | null = null;
  try { saved = localStorage.getItem('dsh-theme'); } catch { /* ignore */ }
  if (saved === 'dark') document.documentElement.classList.add('dark');
  else if (saved === 'light') document.documentElement.classList.add('light');
}

function toggleTheme() {
  const d = document.documentElement.classList;
  if (d.contains('dark')) { d.remove('dark'); d.add('light'); saveTheme('light'); }
  else { d.remove('light'); d.add('dark'); saveTheme('dark'); }
  const dt = document.getElementById('theme-toggle');
  if (dt) dt.textContent = d.contains('dark') ? '☀️' : '🌙';
}

// 幂等守卫：Layout 的打包 <script> 显式调用 initI18n()，而本模块在“自动执行”块里也会调用一次。
// 若不守卫，语言/主题切换按钮会被挂载两份 click 监听，导致点一次语言被连续切换两次（看起来像“切换失败/无效”）。
let _initialized = false;

export function initI18n() {
  initTheme();
  const lang = getLang();
  apply(lang);
  updateToggles(lang);

  // 仅挂载一次监听
  if (!_initialized) {
    _initialized = true;
    const lt = document.getElementById('lang-toggle');
    if (lt) lt.addEventListener('click', () => {
      const next: Lang = getLang() === 'en' ? 'zh' : 'en';
      saveLang(next);
      apply(next);
      updateToggles(next);
    });
    const dt = document.getElementById('theme-toggle');
    if (dt) dt.addEventListener('click', toggleTheme);
  }

  // 暴露给其它脚本（如 app.js / favorites）以重渲染
  (window as unknown as { __dshI18n: unknown }).__dshI18n = { apply, getLang };
}

// 兼容 Astro 打包脚本的自动执行
if (typeof document !== 'undefined') {
  if (document.readyState !== 'loading') initI18n();
  else document.addEventListener('DOMContentLoaded', initI18n);
}
