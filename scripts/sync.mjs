/**
 * DSH Go — 同步引擎 V3
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
import { applyPluginOverride, canonicalRepoKey, canonicalRepoUrl, discoveryRepoId, ensureUniquePluginSlugs, findStoredPluginForRepository, makeInstallCmd, normalizeStoredPlugin } from './repository-identity.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CATALOG_DIR = resolve(ROOT, 'catalog');
const PLUGINS_FILE = resolve(CATALOG_DIR, 'plugins.json');
const META_FILE = resolve(CATALOG_DIR, 'meta.json');
const FEED_FILE = resolve(CATALOG_DIR, 'feed.xml');
const OBSERVED_FILE = resolve(CATALOG_DIR, '.sync-observed.json');

const TOKEN = process.env.GITHUB_TOKEN || '';
const API_BASE = 'https://api.github.com';
const TOPIC = 'topic:dsh-plugin';
// 补充主题：为扩大收录，额外搜索相关生态标签（如 DeepSeek Harness 生态）。
// ⚠️ 补充主题必须带 manifest（dsh-plugin.json）才收录，避免把非插件项目混入目录。
const EXTRA_TOPICS = ['topic:deepseek-harness'];
const NATIVE_ECOSYSTEM_TOPICS = ['topic:dsh-package', 'topic:dsh-mcp', 'topic:dsh-skill', 'topic:dsh-agent'];
const REQUEST_DELAY = 120; // ms，普通资源请求间隔
// 搜索 API 速率：认证 30 req/min、匿名 10 req/min。主动限速避免 403 导致全量中途失败。
const SEARCH_DELAY = TOKEN ? 2200 : 6000; // ms
const README_EXCERPT_LEN = 500;
const MANIFEST_FILES = Object.freeze(['dsh-package.json', 'dsh-plugin.json', 'dsh-mcp.json', 'dsh-skill.json', 'dsh-agent.json']);
const MANIFEST_TYPE_BY_FILE = Object.freeze({
  'dsh-plugin.json': 'plugin', 'dsh-mcp.json': 'mcp', 'dsh-skill.json': 'skill', 'dsh-agent.json': 'agent',
});

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

async function ghFetch(path, { retries = 4 } = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': `dsh-go/${Math.random().toString(36).slice(2, 6)}` };
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
  for (let i = 0; i < retries; i++) {
    let res;
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    } catch (e) {
      // 网络级异常（连接超时 / DNS / 限速断开）——无 HTTP 状态码，退避重试
      log(`网络异常（${e.name || 'fetch失败'}），${3 + i * 2}s 后重试 (${i + 1}/${retries})`, 'warn');
      await sleep((3 + i * 2) * 1000);
      continue;
    }
    if (res.status === 429 || res.status === 403 || res.status >= 500) {
      // GitHub 搜索限速 403 未带 Retry-After 时给长退避；普通 5xx 用短退避
      const retryAfter = Number(res.headers.get('Retry-After') || (res.status === 403 ? 60 : 5));
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
export function isAuthoritativeManifestFile(file) {
  return MANIFEST_FILES.includes(String(file || ''));
}

export function normalizeCategory(value, fallback = 'other') {
  const category = String(value || '').trim();
  return Object.prototype.hasOwnProperty.call(CATEGORIES, category) ? category : fallback;
}

export function sanitizeManifest(data, file = 'dsh-plugin.json') {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const explicitType = String(data.type || data.runtime?.type || '').toLowerCase();
  const type = ['plugin', 'mcp', 'skill', 'agent'].includes(explicitType) ? explicitType : MANIFEST_TYPE_BY_FILE[file] || '';
  if (file === 'dsh-package.json' && !type) return null;
  const clean = {};
  if (typeof data.id === 'string' && /^[A-Za-z0-9_.-]+$/.test(data.id.trim())) clean.id = data.id.trim();
  if (typeof data.name === 'string' && data.name.trim()) clean.name = data.name.trim().slice(0, 200);
  if (typeof data.description === 'string' && data.description.trim()) clean.description = data.description.trim().slice(0, 4000);
  if (typeof data.release_tag === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(data.release_tag.trim())) clean.release_tag = data.release_tag.trim();
  const category = normalizeCategory(data.category, '');
  if (category) clean.category = category;
  clean.tags = Array.isArray(data.tags) ? data.tags.filter((tag) => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean).slice(0, 100) : [];
  const nativeManifest = file !== 'dsh-plugin.json' || Boolean(data.type || data.runtime?.type);
  if (nativeManifest) clean.type = type || 'plugin';
  if (Array.isArray(data.capabilities)) clean.capabilities = data.capabilities.filter((value) => typeof value === 'string').map((value) => value.trim().toLowerCase()).filter(Boolean).slice(0, 100);
  if (Array.isArray(data.dependencies)) clean.dependencies = data.dependencies.slice(0, 200);
  if (Array.isArray(data.permissions)) clean.permissions = data.permissions.filter((value) => typeof value === 'string').map((value) => value.trim().toLowerCase()).filter(Boolean).slice(0, 50);
  for (const field of ['compatibility', 'publisher', 'security']) if (data[field] && typeof data[field] === 'object' && !Array.isArray(data[field])) clean[field] = data[field];
  for (const field of ['conflicts', 'replaces', 'provides']) if (Array.isArray(data[field])) clean[field] = [...new Set(data[field].filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean))].slice(0, 100);
  const typeConfig = data[type || 'plugin'];
  if (typeConfig && typeof typeConfig === 'object' && !Array.isArray(typeConfig)) clean.type_config = typeConfig;
  if (nativeManifest) clean.metadata_source = file.endsWith('.json') ? file.slice(0, -5) : file;
  return clean;
}

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

export function restRepositoryState(repo, previous = {}) {
  const subscribers = repo?.subscribers_count;
  const watchers = typeof subscribers === 'number' && Number.isFinite(subscribers)
    ? subscribers
    : Number(previous?.watchers || 0);
  const deprecated = typeof repo?.archived === 'boolean' ? repo.archived : Boolean(previous?.deprecated);
  const disabled = typeof repo?.disabled === 'boolean' ? repo.disabled : Boolean(previous?.disabled);
  return { watchers, deprecated, disabled };
}

export function detectCategory(repo, _manifest) {
  const topics = (repo.topics || []).map((t) => String(t).toLowerCase());
  const words = new Set(`${repo.description || ''} ${repo.name || ''}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const matches = (kw) => {
    const normalized = String(kw).toLowerCase();
    if (topics.includes(normalized)) return true;
    const parts = normalized.split(/[^a-z0-9]+/).filter(Boolean);
    return parts.length > 0 && parts.every((part) => words.has(part));
  };

  // 用 topics 精确命中优先（注意顺序：先精确标签，再关键词模糊）
  if (topics.some((t) => ['web-ui', 'ui', 'dashboard', 'webapp', 'frontend', 'ui-library'].includes(t))) return 'web-ui';
  if (topics.some((t) => ['mcp', 'model-context-protocol'].includes(t))) return 'mcp';
  if (topics.some((t) => ['skills', 'skill', 'agent-skills', 'dsh-skill'].includes(t))) return 'skills';
  if (topics.some((t) => ['theme', 'themes', 'skin'].includes(t))) return 'theme';
  if (topics.some((t) => ['vision', 'image', 'ocr', 'multimodal', 'multi-modal', 'tesseract'].includes(t))) return 'vision';
  if (topics.some((t) => ['memory', 'vector-db', 'vector-database', 'vectorstore'].includes(t))) return 'memory';
  if (topics.some((t) => ['security', 'auth', 'authentication', 'privacy'].includes(t))) return 'security';
  if (topics.some((t) => ['coding', 'copilot', 'code-review', 'linting'].includes(t))) return 'coding';
  if (topics.some((t) => ['agent', 'multi-agent', 'workflow', 'automation', 'coding-agent', 'agent-tools'].includes(t))) return 'agent';
  if (topics.some((t) => ['terminal', 'cli', 'shell', 'zsh', 'fish', 'bash'].includes(t))) return 'terminal';
  if (topics.some((t) => ['desktop', 'gui', 'tauri', 'electron', 'desktop-pet', 'pet'].includes(t))) return 'desktop';
  if (topics.some((t) => ['cost-tracking', 'token-usage', 'billing', 'usage', 'quota', 'balance'].includes(t))) return 'integration';

  const rule = [
    ['mcp', 'mcp'],
    ['skills', 'skill'],
    ['theme', 'theme'],
    ['vision', 'vision'], ['vision', 'multi-modal'], ['vision', 'image'], ['vision', 'ocr'], ['vision', 'tesseract'],
    ['memory', 'memory'], ['memory', 'vector'],
    ['security', 'security'], ['security', 'auth'],
    ['coding', 'coding'], ['coding', 'code'], ['coding', 'copilot'],
    ['agent', 'agent'], ['agent', 'workflow'], ['agent', 'automation'],
    ['web-ui', 'web'], ['web-ui', 'ui'], ['web-ui', 'react'], ['web-ui', 'vue'], ['web-ui', 'dashboard'],
    ['desktop', 'desktop'], ['desktop', 'gui'], ['desktop', 'tauri'], ['desktop', 'electron'],
    ['terminal', 'terminal'], ['terminal', 'cli'], ['terminal', 'shell'],
    ['integration', 'integration'], ['integration', 'api'], ['integration', 'token'], ['integration', 'cost'], ['integration', 'billing'],
    ['tool', 'tool'], ['tool', 'utility'],
  ];
  for (const [cat, kw] of rule) if (matches(kw)) return cat;
  return 'other';
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
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const normalized = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('$') || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    const canonicalKey = canonicalRepoKey(key);
    if (canonicalKey) normalized[canonicalKey] = value;
  }
  return normalized;
}

function applyOverrides(plugin, overrides) {
  const o = overrides[canonicalRepoKey(plugin.full_name)];
  if (!o) return plugin;
  const result = applyPluginOverride(plugin, o);
  if (Object.prototype.hasOwnProperty.call(o, 'hidden')) result.hidden = Boolean(o.hidden);
  return result;
}

// ---------- DSH 清单抓取（走 raw 域名，不占 REST 配额） ----------
// package.json 是包管理元数据，不是 DSH manifest；不能用于覆盖仓库展示名、分类或 verified。
export async function observeDshManifest(fullName, branch) {
  let observedAny = false;
  for (const file of MANIFEST_FILES) {
    const url = `https://raw.githubusercontent.com/${fullName}/${branch}/${file}`;
    let lastError = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'dsh-go' }, signal: AbortSignal.timeout(15000) });
        if (res.status === 404) { observedAny = true; break; }
        if (!res.ok) {
          lastError = `HTTP ${res.status}`;
          if ([403, 429, 500, 502, 503, 504].includes(res.status) && attempt < 2) { await sleep(500 * (attempt + 1)); continue; }
          return { observed: false, manifest: null, status: res.status, error: lastError };
        }
        observedAny = true;
        let data;
        try { data = await res.json(); }
        catch { return { observed: true, manifest: null, status: res.status, error: `invalid-json:${file}` }; }
        const clean = sanitizeManifest(data, file);
        return { observed: true, manifest: clean ? { file, data: clean } : null, status: res.status, error: clean ? '' : `invalid-manifest:${file}` };
      } catch (error) {
        lastError = error?.message || String(error);
        if (attempt < 2) { await sleep(500 * (attempt + 1)); continue; }
      }
    }
  }
  return { observed: observedAny, manifest: null, status: observedAny ? 404 : 0, error: observedAny ? '' : 'manifest-observation-failed' };
}

async function fetchManifest(fullName, branch) {
  const observation = await observeDshManifest(fullName, branch);
  if (!observation.observed) throw new Error(`DSH manifest observation failed for ${fullName}: ${observation.error || observation.status}`);
  return observation.manifest;
}

export function applyManifestObservation(plugin, observation) {
  const base = normalizeStoredPlugin(plugin);
  if (!observation?.observed) return base;
  const manifest = observation.manifest;
  const data = manifest?.data || {};
  const result = manifest ? {
    ...base,
    package_id: data.id || null,
    package_type: data.type || 'plugin',
    name: data.name || base.repo_name,
    description: data.description || base.description || '',
    category: normalizeCategory(data.category, ({ mcp: 'mcp', skill: 'skills', agent: 'agent' }[data.type] || base.category || 'other')),
    tags: dedupeTags([...(data.tags || []), ...(base.topics || [])]),
    capabilities: data.capabilities || [], dependencies: data.dependencies || [], permissions: data.permissions || [],
    compatibility: data.compatibility || null, publisher: data.publisher || null, security: data.security || null,
    conflicts: data.conflicts || [], replaces: data.replaces || [], provides: data.provides || [], type_config: data.type_config || null,
    release_tag: data.release_tag || null,
    metadata_source: data.metadata_source || manifest.file.replace(/\.json$/, ''), manifest_file: manifest.file, verified: true,
  } : {
    ...base,
    package_id: null, package_type: null, capabilities: [], dependencies: [], permissions: [], compatibility: null, publisher: null, security: null,
    conflicts: [], replaces: [], provides: [], type_config: null,
    release_tag: null,
    name: base.repo_name, metadata_source: 'github', manifest_file: null, verified: false,
  };
  result.install_cmd = makeInstallCmd(result.full_name, result.category);
  result._manifest_observed = true;
  return normalizeStoredPlugin(result);
}

async function fetchReadme(fullName, branch) {
  const url = `https://raw.githubusercontent.com/${fullName}/${branch}/README.md`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'dsh-go' } });
    if (!res.ok) return { has: false, excerpt: '' };
    const text = await res.text();
    return { has: true, excerpt: stripMarkdown(text).slice(0, README_EXCERPT_LEN) };
  } catch { return { has: false, excerpt: '' }; }
}

// ---------- 仓库抓取 ----------
async function searchRepos(query, page = 1, opts = {}) {
  // GitHub 搜索 API 硬限制：最多返回 1000 条（page × per_page ≤ 1000），page 超 10 会 422。
  // 因此必须按相关性/星星排序取 top-1000（高星仓库优先），并限制 page ≤ 10。
  const sort = opts.sort ? `&sort=${opts.sort}&order=${opts.order || 'desc'}` : '';
  const url = `/search/repositories?q=${encodeURIComponent(query)}&per_page=100&page=${Math.min(10, Math.max(1, page))}${sort}`;
  const res = await ghFetch(url);
  if (!res) return { items: [], total: 0 };
  const data = await res.json();
  return { items: data.items || [], total: data.total_count || 0 };
}

// 分桶抓取一个 star 区间查询：单查询够（total<=1000）则取尽全部页；
// 超幅（total>1000，如 stars:0..0 有 5k+）受 GitHub 搜索 API 硬限制只能取 top-1000。
async function fetchRange(query, opts = {}) {
  const sort = opts.sort || 'stars';
  const first = await searchRepos(query, 1, { sort, order: 'desc' });
  const out = [...first.items];
  const total = first.total;
  const cap = total <= 1000;
  const pages = cap ? Math.min(10, Math.ceil(total / 100)) : Math.min(opts.maxPages || 10, 10);
  for (let p = 2; p <= pages; p++) {
    await sleep(SEARCH_DELAY);
    const r = await searchRepos(query, p, { sort, order: 'desc' });
    out.push(...r.items);
    if (r.items.length === 0) break;
  }
  log(`  桶[${query}] total=${total} → 取 ${out.length}（${cap ? '全部' : `top-${out.length}`}）`);
  return out;
}

// ---------- 构建插件对象 ----------
async function buildPlugin(repo, oldPlugins) {
  const fullName = repo.full_name;
  const repoId = discoveryRepoId(repo);
  const old = findStoredPluginForRepository(oldPlugins, repo);
  const manifest = await fetchManifest(fullName, repo.default_branch || 'main');
  const readme = await fetchReadme(fullName, repo.default_branch || 'main');

  const license = repo.license ? repo.license.spdx_id : null;
  const detectedCategory = detectCategory(repo, manifest);
  const typeCategory = ({ mcp: 'mcp', skill: 'skills', agent: 'agent' })[manifest?.data?.type] || '';
  const category = normalizeCategory(manifest?.data?.category || typeCategory, detectedCategory);
  const base = old ? old : {};
  const repoState = restRepositoryState(repo, base);
  const now = new Date().toISOString();

  return normalizeStoredPlugin({
    slug: base.slug || fullName.replace('/', '-'),
    repo_id: repoId,
    name: manifest?.data?.name || repo.name,
    repo_name: repo.name,
    metadata_source: manifest?.data?.metadata_source || (manifest ? manifest.file.replace(/\.json$/, '') : 'github'),
    full_name: fullName,
    description: manifest?.data?.description || repo.description || '',
    category,
    topics: repo.topics || [],
    tags: dedupeTags([...(manifest?.data?.tags || []), ...(repo.topics || [])]),
    stars: repo.stargazers_count || 0,
    forks: repo.forks_count || 0,
    watchers: repoState.watchers,
    open_issues: repo.open_issues_count || 0,
    created_at: repo.created_at || '',
    updated_at: repo.pushed_at || '',
    first_seen: base.first_seen || now,
    trend_score: 0, // 排序后重算
    language: repo.language || '',
    license: license || '',
    install_cmd: makeInstallCmd(fullName, category),
    repo_url: canonicalRepoUrl(fullName),
    homepage: repo.homepage || null,
    deprecated: repoState.deprecated,
    disabled: repoState.disabled,
    verified: Boolean(manifest),
    manifest_file: manifest ? manifest.file : null,
    package_id: manifest?.data?.id || null,
    package_type: manifest?.data?.type || null,
    capabilities: manifest?.data?.capabilities || [],
    dependencies: manifest?.data?.dependencies || [],
    permissions: manifest?.data?.permissions || [],
    compatibility: manifest?.data?.compatibility || null,
    publisher: manifest?.data?.publisher || null,
    security: manifest?.data?.security || null,
    conflicts: manifest?.data?.conflicts || [],
    replaces: manifest?.data?.replaces || [],
    provides: manifest?.data?.provides || [],
    type_config: manifest?.data?.type_config || null,
    release_tag: manifest?.data?.release_tag || null,
    has_readme: readme.has,
    readme_excerpt: readme.excerpt,
    snapshot_commit: repo.default_branch || 'main',
    snapshot_ref: repo.default_branch || 'main',
  });
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
    // GitHub 搜索 API 单查询最多返回 1000 条（page≤10）。要突破 1000 覆盖长尾，
    // 用「star 区间分桶」：各区间独立查询、互不重叠，跨区间并集去重后即可超过 1000。
    // 唯一例外：超大桶（stars:0..0=5.3k、1..5=4.4k）受 GitHub 硬限制只能取各桶 top-1000；
    // 其余 ≥6 星区间 total 均 <1000 可一次取尽，相当于收录了「所有 ≥6 星仓库 + 低星 top-1000」。
    const BUCKETS = [
      'stars:0..0', 'stars:1..5', 'stars:6..10', 'stars:11..50',
      'stars:51..100', 'stars:101..200', 'stars:201..500',
      'stars:501..1000', 'stars:1001..5000', 'stars:5001..999999999',
    ];
    log(`全量模式：按 star 分桶搜索 ${TOPIC} + ${EXTRA_TOPICS.join(', ')}（${BUCKETS.length} 桶，突破单查询 1000 上限）`);
    // 主源：topic:dsh-plugin（默认全量收录）
    for (const buck of BUCKETS) {
      repos.push(...(await fetchRange(`${TOPIC} ${buck}`, { sort: 'stars', maxPages: 10 })));
      await sleep(500); // 桶间呼吸，避免瞬时并发顶到限速
    }
    // 补充主题：分桶并集，但仅标记 extra=true（后面只收带 manifest 的）。
    // ⚠️ 跳过 0~5 星低星桶：补充主题(deepseek-harness)低星候选多为未完成/非插件项目，
    //    且低星桶受 GitHub top-1000 硬限制反而不准。从 ≥6 星开始即可覆盖绝大多数真实插件。
    const extraBuckets = ['stars:6..10', 'stars:11..50', 'stars:51..100', 'stars:101..200',
      'stars:201..500', 'stars:501..1000', 'stars:1001..5000', 'stars:5001..999999999'];
    for (const topic of EXTRA_TOPICS) {
      log(`全量补充主题：${topic}`);
      for (const buck of extraBuckets) {
        const hits = await fetchRange(`${topic} ${buck}`, { sort: 'stars', maxPages: 10 });
        hits.forEach((r) => repos.push({ ...r, __extra: true, __source: topic }));
        await sleep(500);
      }
    }
    for (const topic of NATIVE_ECOSYSTEM_TOPICS) {
      log(`全量原生生态主题：${topic}`);
      for (const buck of BUCKETS) {
        const hits = await fetchRange(`${topic} ${buck}`, { sort: 'stars', maxPages: 10 });
        hits.forEach((r) => repos.push({ ...r, __extra: true, __source: topic }));
        await sleep(500);
      }
    }
    log(`全量搜索完成，共获取 ${repos.length} 个候选（插件主题 + 原生生态主题 + 补充主题分桶并集）`);
    scanned = repos.length;
  } else {
    // 增量模式：只抓上次同步以来 pushed 变更的仓库。
    // 窗口取「上次同步时间点」，但用当日零点避免 pushed:>xx:xx 语法歧义；
    // ⚠️ 若窗口=当日零点（即上次同步就在今天），`pushed:>今天`会返回0，
    //    一旦某次同步空结果被写入就会自锁。因此这里保证最早回退到"昨天"，
    //    并叠加下方【空结果保护】禁止把全域数据覆盖成空。
    const rawSince = lastSyncAt ? new Date(lastSyncAt).getTime() : Date.now() - 7 * 864e5;
    // 回退窗口：最早取 24h 前，避免当天凌晨同步后窗口过窄
    const since = new Date(Math.min(rawSince, Date.now() - 24 * 3600e3)).toISOString().slice(0, 10);
    log(`增量模式：pushed:>${since}`);
    for (let page = 1; page <= 10; page++) {
      const { items, total } = await searchRepos(`${TOPIC} pushed:>${since}`, page);
      scanned += items.length;
      repos.push(...items);
      if (repos.length >= total || items.length === 0) break;
      await sleep(REQUEST_DELAY);
    }
    // 补充/原生生态主题增量：pushed 窗口内候选只收带权威 DSH manifest 的仓库。
    for (const topic of [...EXTRA_TOPICS, ...NATIVE_ECOSYSTEM_TOPICS]) {
      for (let page = 1; page <= 3; page++) {
        const { items } = await searchRepos(`${topic} pushed:>${since}`, page);
        scanned += items.length;
        items.forEach((r) => repos.push({ ...r, __extra: true, __source: topic }));
        if (items.length === 0) break;
        await sleep(REQUEST_DELAY);
      }
    }
  }

  // 【空结果保护】搜索结果为空但旧数据非空时：极可能是搜索 API 被限速/临时故障。
  // 此时若继续用空结果覆盖，会让线上 catalog 变成 0 插件（且增量窗口随之下移，造成自锁）。
  // 因此：增量模式遇到空结果 → 保留旧 plugins 继续跑（复用旧数据），并记录告警。
  const hadOldData = (oldPlugins || []).length > 0;
  if (repos.length === 0 && hadOldData && mode === 'incremental') {
    log(`⚠️ 搜索返回 0 个候选（已存在 ${oldPlugins.length} 个旧插件），疑似 API 限速；保留旧数据，本轮仅更新元数据`, 'warn');
    // 触发一次真实全量搜索兜底，确认是否真的全网无仓库
    for (let page = 1; page <= 3; page++) {
      const { items } = await searchRepos(TOPIC, page);
      scanned += items.length;
      repos.push(...items);
      if (items.length === 0) break;
      await sleep(REQUEST_DELAY);
    }
    if (repos.length === 0) {
      log(`⚠️ 兜底全量搜索仍为 0，极可能是网络/配额问题；本轮写回旧数据，不置空`, 'warn');
      // 用旧 plugins 重新写盘并结束（保留旧数据不被清空）
      const etag = await sha256Hex(JSON.stringify(oldPlugins));
      await writeFile(PLUGINS_FILE, JSON.stringify({ ...oldData, meta: { ...(oldData.meta||{}), count: oldPlugins.length, etag } }, null, 2) + '\n');
      const entry = { at: new Date().toISOString(), mode: 'incremental', duration_ms: Date.now() - startedAt, scanned: 0, included: 0, skipped: 0, data_changed: false, errors: ['搜索返回0，保留旧数据'] };
      const history = [...((oldMeta.history||[]).filter(x=>x.at!==entry.at)), entry].slice(-30);
      await writeFile(META_FILE, JSON.stringify({ last_sync: entry, history }, null, 2) + '\n');
      log(`完成（非空保护）：保留 ${oldPlugins.length} 个旧插件`);
      return;
    }
  }

  // 去重：主源优先——补充主题候选若与主源重复，丢弃补充源条目（保留主源数据）
  const seen = new Set();
  repos = repos.filter((r) => {
    const key = String(discoveryRepoId(r) || canonicalRepoKey(r.full_name));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const extraCount = repos.filter((r) => r.__extra).length;
  log(`搜索到 ${repos.length} 个候选仓库（含补充主题 ${extraCount} 个）`);

  // 搜索 API（/search/repositories）返回的 item 已含 buildPlugin 全部所需字段
  // （full_name/stars/topics/description/default_branch/language/create/update 等）。
  // 因此全量不再逐仓调用 /repos/{full_name} 详情——那会翻倍请求导致核心 API 配额超限。
  // manifest/readme 走 raw.githubusercontent.com，不占 API 配额，安全。
  // 为控制全量时长，用有限并发（默认 16）并行抓取，raw 域名不限速故安全。
  const CONCURRENCY = Number(process.env.SYNC_CONCURRENCY || 16);
  const results = new Array(repos.length);
  let cursor = 0;
  async function worker() {
    while (cursor < repos.length) {
      const idx = cursor++;
      const repo = repos[idx];
      try {
        const p = await buildPlugin(repo, oldPlugins);
        // 补充/原生生态主题候选必须带任一权威 DSH manifest。package.json 永远不提供验证权限。
        if (repo.__extra && !isAuthoritativeManifestFile(p.manifest_file)) {
          skipped++;
          results[idx] = null;
          continue;
        }
        results[idx] = p;
        included++;
        if (included % 50 === 0) log(`已处理 ${included}...`);
      } catch (e) {
        errors.push(`${repo.full_name}: ${e.message}`);
        skipped++;
        results[idx] = null;
        log(`处理失败: ${repo.full_name} - ${e.message}`, 'warn');
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  let plugins = results.filter(Boolean);

  // The liveness sidecar is derived only from records that passed current collection
  // rules. For supplementary topics this means dsh-plugin.json was fetched now, so a
  // repository that removed its manifest cannot inherit a historical verified state.
  if (mode === 'full') {
    const observedRepos = [...new Set(plugins.map((plugin) => plugin.full_name).filter(Boolean))];
    const observedRepoIds = [...new Set(plugins.map((plugin) => String(plugin.repo_id || '')).filter(Boolean))];
    await writeFile(OBSERVED_FILE, JSON.stringify({ mode: 'full', repos: observedRepos, repo_ids: observedRepoIds }, null, 2) + '\n');
    log(`写入临时有效观测集合：repos=${observedRepos.length}, repo_ids=${observedRepoIds.length}`);
  }

  // 保留旧数据中本次未出现的仓库：
  //  - 全量：GitHub 搜索偶发漏项保护（超幅桶 top-1000 轮换时避免误删）
  //  - 增量：窗口内只含"有变更"的仓库，未变更的必须复用旧数据——
  //    否则增量会拿窗口结果整表替换目录（曾导致 3153 → 1000 的数据回退）
  {
    const currentKeys = new Set(plugins.map((p) => canonicalRepoKey(p.full_name)));
    const currentIds = new Set(plugins.map((p) => String(p.repo_id || '')).filter(Boolean));
    let kept = 0;
    for (const oldRaw of oldPlugins) {
      const old = normalizeStoredPlugin(oldRaw);
      const oldKey = canonicalRepoKey(old.full_name);
      const oldId = String(old.repo_id || '');
      if (!currentKeys.has(oldKey) && (!oldId || !currentIds.has(oldId))) { plugins.push(old); kept++; }
    }
    if (kept > 0) log(`${mode} 合并：保留 ${kept} 个未变更旧插件，共 ${plugins.length} 个`);
  }

  // 应用人工覆盖层（优先级最高）
  const overrides = await loadOverrides();
  if (Object.keys(overrides).length) {
    const before = plugins.length;
    plugins = plugins.map((p) => applyOverrides(p, overrides)).filter((p) => !p.hidden);
    log(`应用覆盖层：处理 ${Object.keys(overrides).length} 条，生效后 ${plugins.length} 个（隐藏 ${before - plugins.length} 个）`);
  }

  // Preserve stable ids across renames while repairing the rare case where a new
  // repository later reuses an old owner/name path and would otherwise collide on slug.
  plugins = ensureUniquePluginSlugs(plugins, oldPlugins);

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
      source_topics: [TOPIC, ...EXTRA_TOPICS, ...NATIVE_ECOSYSTEM_TOPICS],
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

export function buildFeed(plugins) {
  // 收录 30 天内的插件（首次全量同步时包含所有新收录插件）
  const items = plugins
    .filter((p) => !p.deprecated && !p.disabled && (Date.now() - new Date(p.first_seen).getTime()) < 30 * 864e5)
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
    <title>DSH Go</title>
    <link>https://dsh-go.pages.dev</link>
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
