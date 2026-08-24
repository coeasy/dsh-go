// scripts/update-readme.mjs —— 在 README.md 内更新「最近热门(300-5000★) 推荐」表格。
// 每次同步后运行（sync.yml 内），保证列表始终是当前目录里最近更新的 Top20。
// 规则：命名与 DSH 强相关（含 dsh / deepseek-harness）+ 区间过滤 + 按最近更新排序，
// 并固定推荐 PINNED 中的必需项目（即使命名不含 dsh 也强制入选）。
// 无插件时输出占位「暂无」。

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const README = join(root, 'README.md');
const CATALOG = join(root, 'catalog', 'plugins.json');

const START = '<!-- HOT-PLUGINS:START -->';
const END = '<!-- HOT-PLUGINS:END -->';

// 收录区间与数目上限
const DEFAULT_MIN = 300;
const DEFAULT_MAX = 5000;
const TOP = 20;

// 必需推荐：无论是否命中命名过滤、无论更新时间，都固定在列表内。
const PINNED = ['liustack/modlens', 'omdsh-dev/DSH-better-sidebar'];

// GitHub 仓库全名 → 仓库首页（与数据一致）
function repoUrl(fullName) {
  return `https://github.com/${fullName}`;
}

// 日期显示：YYYY-MM-DD
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 数字缩写：1.2k / 8.7k
function fmtStars(n) {
  n = Number(n) || 0;
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n);
}

// 简介截断
function clamp(text, max) {
  if (!text) return '—';
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

// 是否 DSH 原生相关：仓库名 / 插件名含 “dsh”，或以 “deepseek-harness” 命名。
// 命中即认为与 DSH 生态强相关；以此剔除那些“只是打了 dsh-plugin 标签、
// 但与 DSH 无实质关联的老开源项目”。
export function isDshRelated(p) {
  const full = `${p.full_name || ''} ${p.name || ''}`;
  return /dsh/i.test(full) || /deepseek-harness/i.test(full);
}

// 挑选推荐列表：PINNED 必需项固定在最前，其余按区间 + DSH 过滤、按最近更新降序补足，总数不超过 top。
export function pickHot(plugins, { min = DEFAULT_MIN, max = DEFAULT_MAX, top = TOP, pinned = PINNED } = {}) {
  const byFull = new Map(plugins.map((p) => [String(p.full_name || '').toLowerCase(), p]));
  const pinnedItems = [];
  for (const id of pinned) {
    const item = byFull.get(String(id).toLowerCase());
    if (item) pinnedItems.push(item);
  }
  const pinnedSet = new Set(pinnedItems.map((x) => x.full_name));
  const rest = plugins
    .filter((p) => {
      const stars = Number(p.stars || 0);
      return stars >= min && stars <= max && isDshRelated(p) && !pinnedSet.has(p.full_name);
    })
    .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))
    .slice(0, top);
  return [...pinnedItems, ...rest].slice(0, top);
}

export function buildTable(hot, { min = DEFAULT_MIN, max = DEFAULT_MAX } = {}) {
  if (!hot.length) {
    return `<p>暂未收录 ${min}-${max}★ 的 DSH 原生插件，敬请期待。</p>\n`;
  }
  const rows = hot.map((p, i) => {
    const name = p.name || p.full_name;
    const desc = (p.description || '').replace(/\|/g, '\\|');
    return `| ${i + 1} | [${name}](${repoUrl(p.full_name)}) | ${fmtStars(p.stars)} | ${p.language || '—'} | ${fmtDate(p.updated_at)} | ${clamp(desc, 42)} |`;
  });
  const header = `| # | 插件 | ★ Stars | 语言 | 最近更新 | 简介 |`;
  const sep = `|---|------|---------|------|----------|------|`;
  return `${header}\n${sep}\n${rows.join('\n')}\n`;
}

function buildSection(hot, { min = DEFAULT_MIN, max = DEFAULT_MAX } = {}) {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${START}\n## 🔥 最近热门推荐（${min}-${max}★）\n\n> 自动生成 · 仅收录**命名含 dsh / deepseek-harness 的 DSH 原生插件**，并固定推荐 modlens · 按最近更新排序 · Top${hot.length || 0}（每次同步后刷新）\n\n${buildTable(hot, { min, max })}\n更新时间：${stamp}\n${END}`;
}

function main() {
  let catalog;
  try {
    catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
  } catch (e) {
    console.warn(`⚠️ 无法读取 catalog：${e.message}`);
    process.exit(0); // 数据缺失时不改 README，避免 CI 误改
  }
  const plugins = Array.isArray(catalog.plugins) ? catalog.plugins : [];
  const hot = pickHot(plugins);
  const section = buildSection(hot);

  let readme;
  try {
    readme = readFileSync(README, 'utf8');
  } catch (e) {
    console.warn(`⚠️ 无法读取 README：${e.message}`);
    process.exit(1);
  }

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${esc(START)}[\\s\\S]*?${esc(END)}`, 'm');
  let next;
  if (re.test(readme)) {
    next = readme.replace(re, section);
  } else {
    // 首次：插入到「特性」段之后、「快速开始」之前
    if (readme.includes('## 快速开始')) {
      next = readme.replace('## 快速开始', `${section}\n\n## 快速开始`);
    } else {
      next = `${readme}\n\n${section}\n`;
    }
  }

  if (next !== readme) {
    writeFileSync(README, next, 'utf8');
    console.log(`✅ 已更新 README 热门推荐表（Top${hot.length}）`);
  } else {
    console.log('ℹ️ 热门推荐表无变化，跳过');
  }
}

// CLI 入口守卫：仅当作为脚本直接运行时才执行 main()，import 时（单元测试）只拿纯函数。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}