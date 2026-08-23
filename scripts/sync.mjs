/**
 * DSH Plugins Nav — 同步引擎 V2
 * =========================================================
 * 模式：
 *   node scripts/sync.mjs            → 自动（默认 incremental）
 *   node scripts/sync.mjs --full     → 全量同步
 *   node scripts/sync.mjs --incremental → 增量同步（pushed: 变更的仓库）
 *
 * 能力：
 *   - 全量：搜索 topic:dsh-plugin 全部仓库，抓取元数据 + 清单 + readme
 *   - 增量：只抓上次同步以来 pushed 变更的仓库，其余复用旧数据
 *   - 内容级 diff：插件数据无变化时不写文件（避免无意义提交/构建）
 *   - first_seen 保留、trend_score 计算、readme_excerpt 提取
 *   - 输出 catalog/plugins.json + catalog/meta.json + catalog/feed.xml
 *
 * 环境变量：
 *   GITHUB_TOKEN  —— 提升 API 配额（可选，无则匿名模式）
 *   SYNC_MODE     —— full / incremental / auto（可替代命令行参数）
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CATALOG_DIR = resolve(ROOT, 'catalog');
const PLUGINS_FILE = resolve(CATALOG_DIR, 'plugins.json');
const META_FILE = resolve(CATALOG_DIR, 'meta.json');
const FEED_FILE = resolve(CATALOG_DIR, 'feed.xml');

const TOKEN = process.env.GITHUB_TOKEN || '';
const API_BASE = 'https://api.github.com';
const TOPIC = 'topic:dsh-plugin';
const REQUEST_DELAY = 120; // ms，避免触发次级限速
const README_EXCERPT_LEN = 500;

const CATEGORIES = {
  'web-ui': 'Web UI 组件',
  'desktop': '桌面端',
  'mcp': 'MCP 工具',
  'skills': '技能 (Skills)',
  'theme': '主题',
  'terminal': '终端工具',
  'coding': '编码辅助',
  'agent': 'Agent 工作流',
  'vision': '视觉 / 多模态',
  'memory': '记忆 / 存储',
  'security': '安全',
  'integration': '集成',
  'tool': '通用工具',
  'other': '其他',
};

// ---------- 通用工具 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(msg, type = 'info') {
  const t = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${t}] ${type.toUpperCase().padEnd(8)} ${msg}`);
}

async function ghFetch(path, { retries = 3 } = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'dsh-hub' };
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, { headers });
    if (res.status === 429 || res.status === 403 || res.status >= 500) {
      const retryAfter = Number(res.headers.get('Retry-After') || '5');
      log(`限速/错误 ${res.status}，${retryAfter}s 后重试 (${i + 1}/${retries})`, 'warn');
      await sleep(retryAfter * 1000);
      continue;
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${url}`);
    return res;
  }
  throw new Error(`GitHub API 重试失败: ${url}`);
}

function sha256Hex(str) {
  // 纯 JS SHA-256（Node 20 自带 crypto）
  return import('node:crypto').then(({ createHash }) =>
    createHash('sha256').update(str).digest('hex').slice(0, 16)
  );
}

function stripMarkdown(md) {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`~_\-|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function computeTrendScore(p) {
  const updated7 = (Date.now() - new Date(p.updated_at).getTime()) < 7 * 864e5 ? 1 : 0;
  const created30 = (Date.now() - new Date(p.created_at).getTime()) < 30 * 864e5 ? 1 : 0;
  return p.stars + 20 * updated7 + 10 * created30;
}

// 合并 manifest.tags 与 GitHub topics，去重并清洗
export function dedupeTags(arr) {
  const out = [];
  const seen = new Set();
  for (const raw of arr || []) {
    if (!raw) continue;
    const t = String(raw).trim().toLowerCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function detectCategory(repo, _manifest) {
  const topics = repo.topics || [];
  const desc = `${repo.description || ''} ${(repo.name || '').toLowerCase()}`;
  const matches = (kw) => topics.includes(kw) || desc.includes(kw);
  const rule = [
    ['mcp', 'mcp'],
    ['skills', 'skill'],
    ['theme', 'theme'],
    ['vision', 'vision'], ['vision', 'multi-modal'], ['vision', 'image'], ['vision', 'ocr'], ['vision', 'tesseract'],
    ['memory', 'memory'], ['memory', 'vector'],
    ['security', 'security'], ['security', 'auth'],
    ['coding', 'coding'], ['coding', 'code'], ['coding', 'copilot'],
    ['agent', 'agent'], ['agent', 'workflow'], ['agent', 'automation'],
    ['web-ui', 'web'], ['web-ui', 'ui'], ['web-ui', 'react'], ['web-ui', 'vue'],
    ['desktop', 'desktop'], ['desktop', 'gui'], ['desktop', 'tauri'], ['desktop', 'electron'],
    ['terminal', 'terminal'], ['terminal', 'cli'], ['terminal', 'shell'],
    ['integration', 'integration'], ['integration', 'api'],
    ['tool', 'tool'], ['tool', 'utility'],
  ];
  for (const [cat, kw] of rule) if (matches(kw)) return cat;
  return 'other';
}

function makeInstallCmd(fullName, category) {
  const profile = category === 'web-ui' ? 'web' : category === 'desktop' ? 'desktop' : 'tools';
  return `dsh plugin --profile ${profile} add github:${fullName}`;
}

// ---------- 数据读取 ----------
async function readJSON(file, fallback) {
  try { await access(file); return JSON.parse(await readFile(file, 'utf-8')); }
  catch { return fallback; }
}

// ---------- 人工覆盖层（catalog/overrides.json） ----------
// 供人工修正自动分类/描述/名称等，优先级高于 manifest 与 GitHub 元数据。
// 结构：{ "owner/repo": { "category": "web-ui", "name": "别名", "description": "修正描述", "tags": [...], "hidden": true } }
async function loadOverrides() {
  const raw = await readJSON(resolve(CATALOG_DIR, 'overrides.json'), {});
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  return {};
}

function applyOverrides(plugin, overrides) {
  const o = overrides[plugin.full_name];
  if (!o) return plugin;
  if (o.name) plugin.name = o.name;
  if (o.description) plugin.description = o.description;
  if (o.category) {
    plugin.category = o.category in CATEGORIES ? o.category : 'other';
    plugin.install_cmd = makeInstallCmd(plugin.full_name, plugin.category);
  }
  if (Array.isArray(o.tags)) plugin.tags = o.tags;
  if (o.homepage) plugin.homepage = o.homepage;
  if (o.hidden) plugin.hidden = true;
  return plugin;
}

// ---------- 清单抓取（走 raw 域名，不占 REST 配额） ----------
async function fetchManifest(fullName, branch) {
  for (const file of ['dsh-plugin.json', 'package.json']) {
    const url = `https://raw.githubusercontent.com/${fullName}/${branch}/${file}`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'dsh-hub' } });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data || typeof data !== 'object') continue;
      return { file, data };
    } catch { /* continue */ }
  }
  return null;
}

async function fetchReadme(fullName, branch) {
  const url = `https://raw.githubusercontent.com/${fullName}/${branch}/README.md`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'dsh-hub' } });
    if (!res.ok) return { has: false, excerpt: '' };
    const text = await res.text();
    return { has: true, excerpt: stripMarkdown(text).slice(0, README_EXCERPT_LEN) };
  } catch { return { has: false, excerpt: '' }; }
}

// ---------- 仓库抓取 ----------
async function searchRepos(query, page = 1) {
  const res = await ghFetch(`/search/repositories?q=${encodeURIComponent(query)}&per_page=100&page=${page}`);
  if (!res) return { items: [], total: 0 };
  const data = await res.json();
  return { items: data.items || [], total: data.total_count || 0 };
}

async function fetchRepoDetail(fullName) {
  const res = await ghFetch(`/repos/${fullName}`);
  if (!res) return null;
  return res.json();
}

// ---------- 构建插件对象 ----------
async function buildPlugin(repo, oldPlugins) {
  const fullName = repo.full_name;
  const old = oldPlugins.find((p) => p.full_name === fullName);
  const manifest = await fetchManifest(fullName, repo.default_branch || 'main');
  const readme = await fetchReadme(fullName, repo.default_branch || 'main');

  const license = repo.license ? repo.license.spdx_id : null;
  const category = manifest?.data?.category || detectCategory(repo, manifest);
  const base = old ? old : {};
  const now = new Date().toISOString();

  return {
    slug: fullName.replace('/', '-'),
    name: manifest?.data?.name || repo.name,
    full_name: fullName,
    description: manifest?.data?.description || repo.description || '',
    category,
    topics: repo.topics || [],
    tags: dedupeTags([...(manifest?.data?.tags || []), ...(repo.topics || [])]),
    stars: repo.stargazers_count || 0,
    forks: repo.forks_count || 0,
    watchers: repo.subscribers_count || repo.watchers_count || 0,
    open_issues: repo.open_issues_count || 0,
    created_at: repo.created_at || '',
    updated_at: repo.pushed_at || '',
    first_seen: base.first_seen || now,
    trend_score: 0, // 排序后重算
    language: repo.language || '',
    license: license || '',
    install_cmd: makeInstallCmd(fullName, category),
    repo_url: repo.html_url || `https://github.com/${fullName}`,
    homepage: repo.homepage || null,
    verified: Boolean(manifest),
    manifest_file: manifest ? manifest.file : null,
    has_readme: readme.has,
    readme_excerpt: readme.excerpt,
    snapshot_commit: repo.default_branch || 'main',
  };
}

// ---------- 主流程 ----------
async function main() {
  await mkdir(CATALOG_DIR, { recursive: true });
  const modeArg = process.argv.includes('--full') ? 'full'
    : process.argv.includes('--incremental') ? 'incremental'
    : (process.env.SYNC_MODE || 'auto');
  const mode = modeArg === 'auto' ? 'incremental' : modeArg;
  log(`同步启动 (mode=${mode})`);

  const oldData = await readJSON(PLUGINS_FILE, { version: 2, meta: { updated_at: null }, plugins: [] });
  const oldPlugins = oldData.plugins || [];
  const oldMeta = await readJSON(META_FILE, { last_sync: null, history: [] });
  const lastSyncAt = oldMeta.last_sync?.at || null;

  const startedAt = Date.now();
  let repos = [];
  let scanned = 0, included = 0, skipped = 0;
  const errors = [];

  if (mode === 'full') {
    log('全量模式：搜索全部 topic:dsh-plugin 仓库');
    for (let page = 1; page <= 10; page++) {
      const { items, total } = await searchRepos(TOPIC, page);
      scanned += items.length;
      repos.push(...items);
      if (repos.length >= total || items.length === 0) break;
      await sleep(REQUEST_DELAY);
    }
  } else {
    // 增量模式：只抓上次同步以来 pushed 变更的仓库
    const since = lastSyncAt ? lastSyncAt.slice(0, 10) : '2020-01-01';
    log(`增量模式：pushed:>${since}`);
    for (let page = 1; page <= 10; page++) {
      const { items, total } = await searchRepos(`${TOPIC} pushed:>${since}`, page);
      scanned += items.length;
      repos.push(...items);
      if (repos.length >= total || items.length === 0) break;
      await sleep(REQUEST_DELAY);
    }
  }

  // 去重
  const seen = new Set();
  repos = repos.filter((r) => (seen.has(r.full_name) ? false : (seen.add(r.full_name), true)));
  log(`搜索到 ${repos.length} 个候选仓库`);

  // 全量时补充抓取单仓详情（搜索 API 返回已含大部分字段，这里补 detail 以获取 topics/homepage）
  const detailNeeded = mode === 'full';
  let plugins = [];
  for (const repo of repos) {
    try {
      let r = repo;
      if (detailNeeded) {
        const detail = await fetchRepoDetail(repo.full_name);
        if (!detail) { skipped++; log(`跳过（仓库不可访问）: ${repo.full_name}`, 'warn'); continue; }
        r = detail;
      }
      const p = await buildPlugin(r, oldPlugins);
      plugins.push(p);
      included++;
      if (included % 20 === 0) log(`已处理 ${included}...`);
      await sleep(REQUEST_DELAY);
    } catch (e) {
      errors.push(`${repo.full_name}: ${e.message}`);
      skipped++;
      log(`处理失败: ${repo.full_name} - ${e.message}`, 'warn');
    }
  }

  // 全量时保留旧数据中本次未出现的仓库（GitHub 搜索偶发漏项保护）
  if (mode === 'full') {
    const currentNames = new Set(plugins.map((p) => p.full_name));
    for (const old of oldPlugins) {
      if (!currentNames.has(old.full_name)) plugins.push(old);
    }
    log(`全量合并后共 ${plugins.length} 个（含旧数据保留）`);
  }

  // 应用人工覆盖层（优先级最高）
  const overrides = await loadOverrides();
  if (Object.keys(overrides).length) {
    const before = plugins.length;
    plugins = plugins.map((p) => applyOverrides(p, overrides)).filter((p) => !p.hidden);
    log(`应用覆盖层：处理 ${Object.keys(overrides).length} 条，生效后 ${plugins.length} 个（隐藏 ${before - plugins.length} 个）`);
  }

  // 排序 + trend_score（verified 优先，其次 trend_score，符合方案 §3.1）
  // 先重算 trend_score，再排序，最后赋 rank（保证 rank/API sort=trend 一致）
  plugins.forEach((p) => { p.trend_score = computeTrendScore(p); });
  plugins.sort((a, b) => {
    if (a.verified !== b.verified) return a.verified ? -1 : 1;
    return (b.trend_score || 0) - (a.trend_score || 0);
  });
  plugins.forEach((p, i) => { p.rank = i + 1; });

  // 统计
  const byCategory = {}, byLanguage = {}, byLicense = {};
  let verifiedCount = 0;
  for (const p of plugins) {
    byCategory[p.category] = (byCategory[p.category] || 0) + 1;
    if (p.language) byLanguage[p.language] = (byLanguage[p.language] || 0) + 1;
    if (p.license) byLicense[p.license] = (byLicense[p.license] || 0) + 1;
    if (p.verified) verifiedCount++;
  }

  const etag = await sha256Hex(JSON.stringify(plugins));
  const newData = {
    version: 2,
    meta: {
      updated_at: new Date().toISOString(),
      source: `github:${TOPIC}`,
      count: plugins.length,
      etag,
      stats: {
        total: plugins.length,
        verified: verifiedCount,
        by_category: byCategory,
        by_language: byLanguage,
        by_license: byLicense,
      },
    },
    plugins,
  };

  // ---------- 内容级 diff ----------
  const oldPluginsJson = JSON.stringify(oldData.plugins || []);
  const newPluginsJson = JSON.stringify(plugins);
  const dataChanged = oldPluginsJson !== newPluginsJson;

  // 数据真实变化才写 plugins.json / feed.xml（无变化则这两个文件保持不变，
  // 使 sync.yml 能据此判断「是否需要触发部署」）
  if (dataChanged) {
    await writeFile(PLUGINS_FILE, JSON.stringify(newData, null, 2) + '\n');
    await writeFile(FEED_FILE, buildFeed(plugins));
    log(`插件数据有变化（${plugins.length} 个），写入 plugins.json + feed.xml`);
  } else {
    log(`插件数据无变化（${plugins.length} 个），跳过 plugins.json / feed.xml`);
  }

  // meta.json 始终写盘（心跳）：线上 /api/v1/meta 的 last_sync.at 持续保持新鲜，
  // 否则 monitor 的「数据新鲜度」检查在同步无变化时会误报。
  // 同步工作流据此判断：plugins/feed 有变化 → 正常提交触发部署；仅 meta 变化 → [no deploy] 心跳提交。
  const entry = {
    at: new Date().toISOString(),
    mode,
    duration_ms: Date.now() - startedAt,
    scanned, included, skipped,
    data_changed: dataChanged,
    errors: errors.slice(0, 10),
  };
  const history = [...(oldMeta.history || []), entry].slice(-30);
  await writeFile(META_FILE, JSON.stringify({ last_sync: entry, history }, null, 2) + '\n');

  log(`完成：${plugins.length} 个插件（扫描 ${scanned}，包含 ${included}，跳过 ${skipped}），耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  if (errors.length) log(`错误 ${errors.length} 条：\n${errors.join('\n')}`, 'warn');
}

// RSS/XML 转义：任何来自第三方（GitHub 元数据 / 插件 manifest）的字符串都必须转义后再插入
function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildFeed(plugins) {
  // 收录 30 天内的插件（首次全量同步时包含所有新收录插件）
  const items = plugins
    .filter((p) => (Date.now() - new Date(p.first_seen).getTime()) < 30 * 864e5)
    .slice(0, 30)
    .map((p) => {
      const isNew = (Date.now() - new Date(p.first_seen).getTime()) < 7 * 864e5;
      const title = `${isNew ? '🆕 ' : '🔄 '}${p.name}`;
      const desc = xmlEscape(p.readme_excerpt || p.description || '').slice(0, 200);
      const link = p.repo_url;
      const date = (p.updated_at || p.first_seen || '').slice(0, 19) + 'Z';
      return `    <item>
      <title>${xmlEscape(title)}</title>
      <link>${xmlEscape(link)}</link>
      <guid isPermaLink="false">${xmlEscape(p.full_name)}@${xmlEscape(p.updated_at)}</guid>
      <pubDate>${new Date(date).toUTCString()}</pubDate>
      <description>${desc}</description>
    </item>`;
    }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>DSH Plugins Nav</title>
    <link>https://dsh-hub.pages.dev</link>
    <description>DeepSeek Harness 插件市场 - 新增与更新插件</description>
    <language>zh-cn</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}

// 仅当作为 CLI 直接运行时执行（被测试 import 时不触发网络）
// 用 realpathSync 统一路径大小写/分隔符，兼容 Windows 下 file:// URL 与本地路径比对
function isMainModule() {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}
if (isMainModule()) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
