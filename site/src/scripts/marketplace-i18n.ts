import { marketTr } from '../i18n/marketplace';
import type { Lang } from '../i18n/config';

let activeLang: Lang = 'en';
let listenersBound = false;

function text(selector: string, key: string, ctx?: Record<string, string | number>) {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) element.textContent = marketTr(key, activeLang, ctx);
}

function setLabelText(selector: string, key: string) {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) return;
  const node = [...element.childNodes].find((child) => child.nodeType === Node.TEXT_NODE);
  if (node) node.textContent = ` ${marketTr(key, activeLang)}`;
}

function translateCount(recommended = false) {
  const count = document.querySelector<HTMLElement>('#market-count');
  if (!count) return;
  const match = count.textContent?.match(/\d+/);
  const n = Number(match?.[0] || 0);
  count.textContent = marketTr(recommended ? 'market_count_recommended' : 'market_count', activeLang, { n });
}

function bindRuntimeRefresh() {
  if (listenersBound) return;
  listenersBound = true;
  const refreshCount = () => queueMicrotask(() => translateCount(false));
  document.querySelector('#market-search')?.addEventListener('input', refreshCount);
  document.querySelector('#market-verified')?.addEventListener('change', refreshCount);
  document.querySelector('#market-registry')?.addEventListener('change', refreshCount);
  document.querySelectorAll('[data-market-filter],[data-category-filter],[data-show-all]').forEach((element) => element.addEventListener('click', refreshCount));

  document.querySelectorAll<HTMLButtonElement>('[data-copy-command]').forEach((button) => {
    const observer = new MutationObserver(() => {
      if (button.textContent === 'Copied') button.textContent = marketTr('market_copied', activeLang);
    });
    observer.observe(button, { childList: true, characterData: true, subtree: true });
  });
}

function localizeCards() {
  document.querySelectorAll<HTMLElement>('.market-card').forEach((card) => {
    const source = card.querySelector<HTMLElement>('.source');
    if (source?.classList.contains('catalog')) source.textContent = marketTr('market_catalog_only', activeLang);

    const stars = card.querySelector<HTMLElement>('.stars');
    if (stars?.textContent?.trim() === 'New' || stars?.dataset.i18nNew === 'true') {
      stars.dataset.i18nNew = 'true';
      stars.textContent = marketTr('market_new', activeLang);
    }

    const description = card.querySelector<HTMLElement>('.description');
    if (description && (description.textContent?.trim() === '暂无描述' || description.dataset.i18nEmpty === 'true')) {
      description.dataset.i18nEmpty = 'true';
      description.textContent = marketTr('market_no_description', activeLang);
    }

    card.querySelectorAll<HTMLElement>('.meta-row span').forEach((meta) => {
      const value = meta.textContent?.trim() || '';
      if (value.startsWith('Updated ') || meta.dataset.i18nKind === 'updated') {
        meta.dataset.i18nKind = 'updated';
        meta.dataset.i18nValue ||= value.replace(/^Updated\s+/, '');
        meta.textContent = marketTr('market_updated_item', activeLang, { date: meta.dataset.i18nValue || '' });
      } else if (/^\d+ deps$/.test(value) || meta.dataset.i18nKind === 'deps') {
        meta.dataset.i18nKind = 'deps';
        meta.dataset.i18nValue ||= value.match(/^\d+/)?.[0] || '0';
        meta.textContent = marketTr('market_deps', activeLang, { n: meta.dataset.i18nValue });
      } else if (value.startsWith('commit ') || meta.dataset.i18nKind === 'commit') {
        meta.dataset.i18nKind = 'commit';
        meta.dataset.i18nValue ||= value.replace(/^commit\s+/, '');
        meta.textContent = marketTr('market_commit', activeLang, { sha: meta.dataset.i18nValue || '' });
      } else if (value === 'Catalog linked' || meta.dataset.i18nKind === 'catalog-linked') {
        meta.dataset.i18nKind = 'catalog-linked';
        meta.textContent = marketTr('market_catalog_linked', activeLang);
      }
    });

    const actions = card.querySelectorAll<HTMLElement>('.card-actions > *');
    if (actions[0]) actions[0].textContent = marketTr('market_details', activeLang);
    if (actions[1]) actions[1].textContent = marketTr('market_open_dsh', activeLang);
    if (actions[2] && actions[2].textContent !== marketTr('market_copied', activeLang)) actions[2].textContent = marketTr('market_copy_cli', activeLang);
  });
}

function localizeRootChrome() {
  text('.v4-links > a strong', 'root_trust_center');
  text('.v4-links > a span', 'root_trust_summary');
  text('.locale-links > strong', 'root_localized_marketplace');

  const status = document.querySelector<HTMLElement>('.market-sync-status');
  const time = status?.querySelector<HTMLTimeElement>('time');
  if (status && time?.dateTime) {
    const parsed = new Date(time.dateTime);
    const formatted = Number.isNaN(parsed.getTime()) ? time.textContent || '' : new Intl.DateTimeFormat(activeLang, {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(parsed);
    status.replaceChildren(
      document.createTextNode(marketTr('root_last_sync_prefix', activeLang)),
      Object.assign(document.createElement('time'), { dateTime: time.dateTime, textContent: formatted }),
      document.createTextNode(marketTr('root_beijing_suffix', activeLang)),
    );
  }

  const localeNav = document.querySelector<HTMLElement>('.locale-nav');
  if (localeNav) localeNav.setAttribute('aria-label', marketTr('locale_nav_aria', activeLang));
  text('.locale-nav .trust', 'root_trust_center');
  text('.local-note', 'locale_local_note');
}

export function applyMarketplaceI18n(lang: Lang) {
  activeLang = lang;
  if (typeof document === 'undefined') return;

  text('.market-hero .eyebrow', 'market_eyebrow');
  const title = document.querySelector<HTMLElement>('.market-hero h1');
  const titleAccent = title?.querySelector<HTMLElement>('.grad-text');
  if (title && titleAccent) {
    title.firstChild!.textContent = `${marketTr('market_title_before', activeLang)} `;
    titleAccent.textContent = marketTr('market_title_ecosystem', activeLang);
  }
  text('.market-hero > p', 'market_intro');

  const primary = document.querySelector<HTMLElement>('.market-hero .hero-actions .primary');
  if (primary) {
    const n = primary.textContent?.match(/\d+/)?.[0] || '100';
    primary.textContent = marketTr('market_explore_top', activeLang, { n });
  }
  text('.market-hero .hero-actions .secondary', 'market_browse_all');

  const metricLabels = document.querySelectorAll<HTMLElement>('.market-hero .metrics i');
  ['market_metric_packages', 'market_metric_registry', 'market_metric_recommended', 'market_metric_updated'].forEach((key, index) => {
    if (metricLabels[index]) metricLabels[index].textContent = marketTr(key, activeLang);
  });

  text('.category-section .section-kicker', 'market_browse_by_type');
  text('.category-section h2', 'market_categories_title');
  text('.category-section .section-note', 'market_categories_note');
  const typeKeys: Record<string, [string, string]> = {
    plugin: ['market_type_plugin_label', 'market_type_plugin_desc'],
    mcp: ['market_type_mcp_label', 'market_type_mcp_desc'],
    skill: ['market_type_skill_label', 'market_type_skill_desc'],
    agent: ['market_type_agent_label', 'market_type_agent_desc'],
  };
  document.querySelectorAll<HTMLElement>('[data-category-filter]').forEach((card) => {
    const keys = typeKeys[card.dataset.categoryFilter || ''];
    if (!keys) return;
    const strong = card.querySelector<HTMLElement>('.category-copy strong');
    const small = card.querySelector<HTMLElement>('.category-copy small');
    if (strong) strong.textContent = marketTr(keys[0], activeLang);
    if (small) small.textContent = marketTr(keys[1], activeLang);
  });

  const facts = document.querySelectorAll<HTMLElement>('.market-facts > div');
  if (facts[0]) {
    const strong = facts[0].querySelector<HTMLElement>('strong');
    const desc = facts[0].querySelector<HTMLElement>('span');
    const titleText = strong?.textContent || '';
    const range = titleText.match(/([\d.]+[Kk]?)\s*[–-]\s*([\d.]+[Kk]?)/);
    const numbers = desc?.textContent?.match(/\d+/g) || [];
    if (strong) strong.textContent = marketTr('market_fact_top_title', activeLang, { min: range?.[1] || '100', max: range?.[2] || '10k' });
    if (desc) desc.textContent = marketTr('market_fact_top_desc', activeLang, { giants: numbers[0] || 0, aggregators: numbers[1] || 0 });
  }
  if (facts[1]) {
    const strong = facts[1].querySelector<HTMLElement>('strong');
    const desc = facts[1].querySelector<HTMLElement>('span');
    if (strong) strong.textContent = marketTr('market_fact_registry_title', activeLang);
    if (desc) desc.textContent = marketTr('market_fact_registry_desc', activeLang);
  }
  if (facts[2]) {
    const strong = facts[2].querySelector<HTMLElement>('strong');
    const desc = facts[2].querySelector<HTMLElement>('span');
    if (strong) strong.textContent = marketTr('market_fact_local_title', activeLang);
    if (desc) desc.textContent = marketTr('market_fact_local_desc', activeLang);
  }

  const search = document.querySelector<HTMLInputElement>('#market-search');
  if (search) search.placeholder = marketTr('market_search_placeholder', activeLang);
  document.querySelectorAll<HTMLElement>('[data-market-filter]').forEach((button) => {
    const key = button.dataset.marketFilter === 'all' ? 'market_filter_all' : 'market_filter_recommended';
    const small = button.querySelector<HTMLElement>('small');
    const count = small?.textContent || '';
    button.childNodes[0].textContent = `${marketTr(key, activeLang)} `;
    if (small) small.textContent = count;
  });
  setLabelText('.check-filter:has(#market-verified)', 'market_filter_verified');
  setLabelText('.check-filter:has(#market-registry)', 'market_filter_registry');

  const resultLinks = document.querySelectorAll<HTMLElement>('.result-links a');
  if (resultLinks[0]) resultLinks[0].textContent = marketTr('market_profiles', activeLang);
  if (resultLinks[1]) resultLinks[1].textContent = marketTr('market_trending', activeLang);
  if (resultLinks[2]) resultLinks[2].textContent = marketTr('market_search_api', activeLang);
  translateCount(document.querySelector<HTMLButtonElement>('[data-market-filter="popular"]')?.classList.contains('active') === true);
  text('#market-empty', 'market_empty');
  localizeCards();
  localizeRootChrome();
  bindRuntimeRefresh();
}
