// scripts/update-readme.mjs —— 在 README.md 内更新「最近热门(1000-3000★) 推荐」表格。
// 每次同步后运行（sync.yml 内），保证列表始终是当前目录里最近更新的 Top20。
// 区间外的仓库不入选；无插件时输出占位「暂无」。

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const README = join(root, 'README.md');
const CATALOG = join(root, 'catalog', 'plugins.json');

const START = '<!-- HOT-PLUGINS:START -->';
const END = '<!-- HOT-PLUGINS:END -->';

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

function pickHot(plugins, { min = 1000, max = 3000, top = 20 } = {}) {
  return plugins
    .filter((p) => Number(p.stars || 0) >= min && Number(p.stars || 0) <= max)
    .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))
    .slice(0, top);
}

function buildTable(hot) {
  if (!hot.length) {
    return `<p>暂无 1000-3000★ 的插件收录，敬请期待。</p>\n`;
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

function buildSection(hot) {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${START}\n## 🔥 最近热门推荐（1000-3000★）\n\n> 自动生成 · 按最近更新排序 · Top${hot.length || 0}（每次同步后刷新）\n\n${buildTable(hot)}\n更新时间：${stamp}\n${END}`;
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

main();