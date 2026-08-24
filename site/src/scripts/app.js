// site/src/scripts/app.js —— 首页客户端逻辑
// 搜索/分类/排序/筛选全部同步到 URL 参数（可分享、刷新保留）
(function () {
  'use strict';

  const state = { q: '', category: 'all', sort: 'stars', filter: 'all' };
  const $search = document.getElementById('search');
  const $chipsCat = document.querySelectorAll('.cat-chips .chip[data-cat]');
  const $chipsSort = document.querySelectorAll('.sort-line .chip[data-sort]');
  const $chipsFilter = document.querySelectorAll('.sort-line .chip[data-filter]');
  const $grid = document.getElementById('grid');
  const $empty = document.getElementById('empty');
  const $count = document.getElementById('result-count');
  const cards = Array.from(document.querySelectorAll('.plugin-card'));

  // 结果计数走 i18n 词条（data-results 由 i18n.apply 渲染，切语言自动更新）
  // 注：本脚本是 inline 同步执行，可能早于 i18n 模块（defer）就绪；
  // 未就绪时仅更新属性、保留服务端渲染的初始文本，避免闪成裸数字。
  function updateCount(n) {
    if (!$count) return;
    $count.setAttribute('data-results', String(n));
    const i18n = window.__dshI18n;
    if (i18n && i18n.apply) i18n.apply(i18n.getLang());
  }

  function readStateFromURL() {
    const p = new URLSearchParams(location.search);
    state.q = p.get('q') || '';
    state.category = p.get('category') || 'all';
    state.sort = p.get('sort') || 'stars';
    state.filter = p.get('filter') || 'all';
  }

  function writeStateToURL() {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.sort !== 'stars') p.set('sort', state.sort);
    if (state.filter !== 'all') p.set('filter', state.filter);
    const qs = p.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  }

  function syncUI() {
    if ($search) $search.value = state.q;
    $chipsCat.forEach((c) => c.classList.toggle('active', c.dataset.cat === state.category));
    $chipsSort.forEach((c) => c.classList.toggle('active', c.dataset.sort === state.sort));
    $chipsFilter.forEach((c) => c.classList.toggle('active', c.dataset.filter === state.filter));
  }

  function applyAll() {
    writeStateToURL();

    // 筛选
    const visible = cards.filter((card) => {
      const d = card.dataset;
      let ok = true;
      if (state.category !== 'all') ok = ok && d.category === state.category;
      if (state.filter === 'verified') ok = ok && d.verified === 'true';
      if (state.filter === 'new') ok = ok && d.isNew === 'true';
      if (state.q) {
        const kw = state.q.toLowerCase();
        const hay = `${d.name} ${d.desc} ${d.tags}`.toLowerCase();
        ok = ok && hay.includes(kw);
      }
      return ok;
    });

    // 排序
    const num = (v) => Number(v) || 0;
    if (state.sort === 'stars') visible.sort((a, b) => num(b.dataset.stars) - num(a.dataset.stars));
    else if (state.sort === 'trend') visible.sort((a, b) => num(b.dataset.trend) - num(a.dataset.trend));
    else if (state.sort === 'created') visible.sort((a, b) => (b.dataset.created || '').localeCompare(a.dataset.created || ''));
    else if (state.sort === 'updated') visible.sort((a, b) => (b.dataset.updated || '').localeCompare(a.dataset.updated || ''));
    else visible.sort((a, b) => a.dataset.name.localeCompare(b.dataset.name));

    visible.forEach((el) => { $grid.appendChild(el); el.style.display = ''; });
    cards.filter((c) => !visible.includes(c)).forEach((el) => { el.style.display = 'none'; });

    if ($empty) $empty.hidden = visible.length > 0;
    updateCount(visible.length);
  }

  // 事件绑定
  if ($search) {
    let t;
    $search.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { state.q = $search.value.trim(); applyAll(); }, 180);
    });
    // 「/」快捷键聚焦搜索（输入框内按 Esc 清空）
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== $search) {
        e.preventDefault();
        $search.focus();
      } else if (e.key === 'Escape' && document.activeElement === $search) {
        $search.value = '';
        state.q = '';
        applyAll();
      }
    });
  }
  $chipsCat.forEach((c) => c.addEventListener('click', () => { state.category = c.dataset.cat; syncUI(); applyAll(); }));
  $chipsSort.forEach((c) => c.addEventListener('click', () => { state.sort = c.dataset.sort; syncUI(); applyAll(); }));
  $chipsFilter.forEach((c) => c.addEventListener('click', () => { state.filter = c.dataset.filter; syncUI(); applyAll(); }));

  // 初始化
  readStateFromURL();
  syncUI();
  applyAll();
})();
