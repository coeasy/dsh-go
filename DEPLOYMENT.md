# DSH Go — 全自动免费部署方案

> ⚠️ **内部运维文档**：本文件为项目**内部部署/运维方案**，面向项目维护者，含密钥、域名、账号等内部细节，**不作为对外宣传文档分发，请勿外传**。
> 对外使用说明请以仓库根 `README.md` 与站点 `/docs` 为准。

> **场景 B：导航站 + 开放公共 API + 自定义域名**
> 每天定时自动同步 → 自动部署到 Cloudflare Pages → 全球 CDN 公开访问 → 第三方可跨域调用 API

---

## 一、项目定位

构建一个 **DeepSeek Harness 插件导航站**，具备：

1. **插件发现**：自动抓取 GitHub `topic:dsh-plugin` 下的所有公开仓库
2. **分类浏览**：按 Web UI / Desktop / MCP / Skills / Theme / Terminal / Coding / Agent 等分类
3. **搜索排序**：关键词搜索 + 按 Stars / 更新时间 / 许可证排序
4. **一键安装**：每个插件展示 `dsh plugin --profile web add github:owner/repo` 命令
5. **开放 API**：第三方网站/应用可跨域调用 `https://your-domain.com/api/plugins.json`
6. **每日自动更新**：北京时间 09:17 自动同步，全程无人干预
7. **零成本**：Cloudflare Pages Free + GitHub Actions 公共仓库免费额度

---

## 二、架构总览

```
┌──────────────────────────────────────────────────────────────────┐
│                        GitHub Repository                         │
│  main 分支                                                      │
│                                                                  │
│  ├── .github/workflows/sync.yml      ← 每天 09:17 定时触发       │
│  ├── .github/workflows/deploy.yml    ← push main 时触发部署      │
│  ├── scripts/                                                  │
│  │   ├── sync.mjs                  ← 抓取 + 校验插件数据        │
│  │   ├── validate.mjs               ← 校验 dsh-plugin 清单格式   │
│  │   └── generate.mjs               ← 生成 catalog/*.json        │
│  ├── site/                          ← 前端站点 (Astro)           │
│  │   ├── src/pages/                                                │
│  │   │   ├── index.astro           ← 首页 (列表 + 搜索 + 分类)   │
│  │   │   ├── plugin/[slug].astro   ← 插件详情页                  │
│  │   │   └── api/plugins.json.ts   ← 公共 API 端点              │
│  │   ├── src/components/                                           │
│  │   ├── package.json                                               │
│  │   └── astro.config.mjs                                           │
│  ├── catalog/                       ← 同步产出的数据              │
│  │   ├── plugins.json               ← 插件主数据 (API 数据源)     │
│  │   ├── repositories.json          ← 仓库原始元数据              │
│  │   └── snapshot-commit.txt        ← 目录校验快照                │
│  ├── _headers                       ← CORS + 安全响应头           │
│  ├── _redirects                     ← URL 重定向规则              │
│  ├── wrangler.toml                  ← Cloudflare 部署配置         │
│  └── README.md                                                     │
└──────────────┬───────────────────────────────┬───────────────────┘
               │                               │
    ① 每天定时同步数据              ② push main 触发
               │                               │
               ▼                               ▼
       GitHub Actions                    Cloudflare Pages
       (npm run sync)                   (自动构建 + 全球 CDN)
       │                                       │
       │ git push (有变化时)                    │
       └───────────────────────────────────────┘
                                               │
                                               ▼
                               ┌─────────────────────────────┐
                               │   公开访问 (公网 URL)        │
                               │                             │
                               │  https://your-domain.com    │
                               │  https://your-domain.com/   │
                               │    api/plugins.json  ← 公共 API
                               │                             │
                               │  全球 CDN 边缘节点           │
                               │  无限带宽 / 无限请求         │
                               └─────────────────────────────┘
```

---

## 三、公开访问与第三方调用策略（场景 B 核心）

### 3.1 访问层级说明

| 资源路径 | 访问权限 | 说明 |
|---|---|---|
| `/` (首页) | 公网开放 | 任何人浏览器可访问 |
| `/plugin/*` (详情页) | 公网开放 | 任何人浏览器可访问 |
| `/api/plugins.json` | **跨域开放 (CORS *)** | 第三方前端 JS 可调用 |
| `/api/plugins/{slug}.json` | **跨域开放 (CORS *)** | 第三方前端 JS 可调用 |
| `/catalog/plugins.json` | 公网开放 | 直接下载原始 JSON |

### 3.2 CORS 配置（`_headers` 文件）

```headers
# ============================================================
# 公共 API：允许第三方跨域调用
# ============================================================
/api/*
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, OPTIONS
  Access-Control-Allow-Headers: Content-Type, Authorization
  Access-Control-Max-Age: 86400
  Cache-Control: public, max-age=300, s-maxage=3600
  X-Content-Type-Options: nosniff

# ============================================================
# 静态资源：允许跨域加载（CDN 加速场景）
# ============================================================
/assets/*
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=31536000, immutable

/* 
  Access-Control-Allow-Origin: *
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), camera=(), microphone=()

# ============================================================
# 防止 *.pages.dev 被搜索引擎重复索引（绑定自定义域名后）
# ============================================================
https://:project.pages.dev/*
  X-Robots-Tag: noindex, nofollow
```

### 3.3 第三方调用示例

```javascript
// 第三方网站的前端 JS 直接调用
const res = await fetch('https://your-domain.com/api/plugins.json');
const data = await res.json();
console.log(`共 ${data.count} 个插件`);
```

```bash
# 命令行直接获取
curl https://your-domain.com/api/plugins.json | jq '.count'
```

```python
# Python 后端调用
import requests
data = requests.get('https://your-domain.com/api/plugins.json').json()
```

### 3.4 API 速率限制（防刷保护）

在 Cloudflare 控制台配置 **WAF → Rate Limiting Rules**：

| 规则 | 阈值 | 动作 |
|---|---|---|
| 单 IP 请求 `/api/*` | 每分钟 60 次 | 超出返回 429 |
| 单 IP 请求 `/api/*` | 每分钟 120 次 | 超出封禁 1 小时 |
| 全局 QPS | 1000/秒 | 超出排队 |

> 💡 **Free 套餐支持 1 条 Rate Limiting 规则**，足够保护 API 不被单个 IP 刷爆。

---

## 四、GitHub Actions 工作流

### 4.1 每日同步工作流 (`.github/workflows/sync.yml`)

```yaml
name: Daily Sync Plugins

on:
  schedule:
    # 北京时间 09:17 (UTC+8 = 01:17 UTC)
    # 避开整点，减少队列竞争
    - cron: "17 1 * * *"
  workflow_dispatch:  # 允许手动触发

permissions:
  contents: write
  actions: read

jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      # ── 1. 检出代码 ──────────────────────────────────────
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}

      # ── 2. 安装 Node.js ──────────────────────────────────
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      # ── 3. 运行同步脚本 ──────────────────────────────────
      - name: Sync plugin data
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npm run sync

      # ── 4. 校验数据完整性 ────────────────────────────────
      - name: Validate catalog
        run: npm run validate

      # ── 5. 检测是否有变更 ────────────────────────────────
      - name: Check for changes
        id: verify_diff
        run: |
          git diff --quiet catalog/ || echo "changed=true" >> $GITHUB_OUTPUT
          git diff --quiet site/src/data/ || echo "data_changed=true" >> $GITHUB_OUTPUT

      # ── 6. 有变更则提交并推送 ────────────────────────────
      - name: Commit & push changes
        if: steps.verify_diff.outputs.changed == 'true'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add -A
          git commit -m "chore: 自动更新插件目录 [skip ci]"
          git push

      # ── 7. 每周心跳（防止 60 天无活动被禁用）─────────────
      - name: Weekly heartbeat
        if: github.event.schedule == '17 1 * * 1'  # 每周一
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git commit --allow-empty -m "chore: weekly heartbeat [skip ci]" || true
          git push

      # ── 8. 通知（可选）──────────────────────────────────
      - name: Notify Telegram
        if: steps.verify_diff.outputs.changed == 'true' && env.TELEGRAM_BOT_TOKEN != ''
        env:
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
        run: |
          COUNT=$(jq '.count' catalog/plugins.json)
          curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
            -d "chat_id=${TELEGRAM_CHAT_ID}" \
            -d "text=✅ DSH 插件导航已更新：${COUNT} 个插件"
```

### 4.2 部署工作流 (`.github/workflows/deploy.yml`)

```yaml
name: Deploy to Cloudflare Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  deployments: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 20

    steps:
      # ── 1. 检出代码 ──────────────────────────────────────
      - name: Checkout
        uses: actions/checkout@v4

      # ── 2. 安装 Node.js ──────────────────────────────────
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      # ── 3. 构建前端站点 ──────────────────────────────────
      - name: Build site
        run: npm run build

      # ── 4. 部署到 Cloudflare Pages ──────────────────────
      - name: Deploy to Cloudflare Pages
        uses: cloudflare/pages-action@v1
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          projectName: dsh-hub
          directory: site/dist
          gitHubToken: ${{ secrets.GITHUB_TOKEN }}

      # ── 5. 部署后通知（可选）────────────────────────────
      - name: Notify success
        if: env.TELEGRAM_BOT_TOKEN != ''
        env:
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
        run: |
          curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
            -d "chat_id=${TELEGRAM_CHAT_ID}" \
            -d "text=🚀 Cloudflare Pages 部署成功"
```

---

## 五、同步脚本核心逻辑

### 5.1 `scripts/sync.mjs`

```javascript
#!/usr/bin/env node
/**
 * DSH Plugins Nav — 同步脚本
 * 
 * 功能：
 * 1. 搜索 GitHub topic:dsh-plugin 的所有公开仓库
 * 2. 提取每个仓库的元数据（package.json / dsh-plugin.json / README）
 * 3. 过滤非插件仓库（纯桌面壳、独立应用、索引站）
 * 4. 分类标注 + verified 标记
 * 5. 生成 catalog/plugins.json
 * 
 * 运行：npm run sync
 * 环境变量：GITHUB_TOKEN (GitHub API 认证)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CATALOG_DIR = path.join(ROOT, 'catalog');

// ── 配置 ──────────────────────────────────────────────────
const CONFIG = {
  githubApi: 'https://api.github.com',
  searchQuery: 'topic:dsh-plugin',
  maxRepos: 500,           // 最多抓取仓库数
  requestDelay: 1000,      // GitHub API 限速保护
  excludedPatterns: [
    // 排除非插件仓库
    /-desktop$/i,
    /-app$/i,
    /-client$/i,
    /awesome-/i,
    /list-/i,
    /directory/i,
    /index/i,
    /nav/i,
    /hub/i,
    /store/i,
    /market/i,
  ],
  categories: {
    'web-ui':     ['web-ui', 'webui', 'web-ui', 'frontend', 'ui', 'interface'],
    'desktop':    ['desktop', 'electron', 'tauri', 'native'],
    'mcp':        ['mcp', 'model-context-protocol', 'protocol'],
    'skills':     ['skill', 'capability', 'ability'],
    'theme':      ['theme', 'dark', 'light', 'style', 'ui-theme'],
    'terminal':   ['terminal', 'tui', 'cli', 'console', 'shell'],
    'coding':     ['code', 'coding', 'programming', 'dev', 'developer'],
    'agent':      ['agent', 'workflow', 'automation', 'multi-agent'],
    'vision':     ['vision', 'image', 'ocr', 'visual', 'screenshot'],
    'memory':     ['memory', 'recall', 'rag', 'vector', 'embed'],
    'security':   ['security', 'guard', 'sandbox', 'permission'],
    'integration': ['integration', 'bridge', 'connector', 'adapter'],
    'tool':       ['tool', 'utility', 'helper', 'utils'],
  },
};

// ── GitHub API 封装 ────────────────────────────────────────
class GitHubClient {
  constructor(token) {
    this.token = token;
    this.rateLimitRemaining = Infinity;
  }

  async request(url, options = {}) {
    const headers = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'dsh-hub',
      ...options.headers,
    };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const res = await fetch(url, { ...options, headers });
    
    // 更新速率限制
    this.rateLimitRemaining = parseInt(res.headers.get('X-RateLimit-Remaining') || '0');
    
    if (res.status === 404) return null;
    if (res.status === 403) {
      const reset = parseInt(res.headers.get('X-RateLimit-Reset') || '0');
      const wait = Math.max(0, reset * 1000 - Date.now()) + 1000;
      console.warn(`⚠️  API 限速，等待 ${Math.ceil(wait/1000)}s...`);
      await sleep(wait);
      return this.request(url, options);
    }
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${url}`);
    
    return res.json();
  }

  async searchRepos(query, max = 100) {
    const all = [];
    let page = 1;
    while (all.length < max) {
      const data = await this.request(
        `${CONFIG.githubApi}/search/repositories?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=100&page=${page}`
      );
      if (!data?.items?.length) break;
      all.push(...data.items);
      if (data.items.length < 100) break;
      page++;
      await sleep(CONFIG.requestDelay);
    }
    return all.slice(0, max);
  }

  async getFile(repo, filepath) {
    const url = `${CONFIG.githubApi}/repos/${repo}/contents/${filepath}`;
    const data = await this.request(url);
    if (!data?.content) return null;
    return JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
  }

  async getReadme(repo) {
    const data = await this.request(`${CONFIG.githubApi}/repos/${repo}/readme`);
    if (!data?.content) return '';
    return Buffer.from(data.content, 'base64').toString('utf-8');
  }
}

// ── 分类逻辑 ──────────────────────────────────────────────
function classifyPlugin(name, description, topics = []) {
  const text = `${name} ${description} ${(topics || []).join(' ')}`.toLowerCase();
  
  for (const [category, keywords] of Object.entries(CONFIG.categories)) {
    for (const kw of keywords) {
      if (text.includes(kw)) return category;
    }
  }
  
  return 'other';
}

// ── 插件校验 ──────────────────────────────────────────────
function isValidPlugin(repo) {
  const name = repo.name.toLowerCase();
  
  // 排除非插件仓库
  for (const pattern of CONFIG.excludedPatterns) {
    if (pattern.test(name)) return false;
  }
  
  // 必须有描述
  if (!repo.description) return false;
  
  // 必须是公开仓库
  if (repo.private) return false;
  
  // 排除 fork 超过一定比例的（通常是镜像）
  if (repo.fork && repo.stargazers_count < 5) return false;
  
  return true;
}

// ── 提取安装命令 ──────────────────────────────────────────
function getInstallCommand(repo) {
  const fullName = repo.full_name;
  // 根据分类推断 profile
  const cat = classifyPlugin(repo.name, repo.description || '', repo.topics);
  const profile = cat === 'desktop' ? 'desktop' : 'web';
  return `dsh plugin --profile ${profile} add github:${fullName}`;
}

// ── 主流程 ────────────────────────────────────────────────
async function main() {
  console.log('🔍 开始同步 DSH 插件数据...\n');
  
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn('⚠️  未设置 GITHUB_TOKEN，将使用匿名限额 (60 req/h)');
  }
  
  const client = new GitHubClient(token);
  
  // Step 1: 搜索仓库
  console.log('📡 搜索 GitHub topic:dsh-plugin ...');
  const repos = await client.searchRepos(CONFIG.searchQuery, CONFIG.maxRepos);
  console.log(`   找到 ${repos.length} 个仓库\n`);
  
  // Step 2: 过滤 + 提取元数据
  console.log('🔎 过滤并提取元数据...');
  const plugins = [];
  const errors = [];
  
  for (const repo of repos) {
    try {
      if (!isValidPlugin(repo)) continue;
      
      // 尝试获取 dsh-plugin.json 或 package.json
      let manifest = null;
      try {
        manifest = await client.getFile(repo.full_name, 'dsh-plugin.json');
      } catch {}
      
      if (!manifest) {
        try {
          manifest = await client.getFile(repo.full_name, 'package.json');
        } catch {}
      }
      
      const readme = await client.getReadme(repo.full_name).catch(() => '');
      
      const category = classifyPlugin(repo.name, repo.description || '', repo.topics);
      
      const plugin = {
        // 基础信息
        slug: repo.full_name.toLowerCase().replace(/\//g, '-'),
        name: manifest?.name || repo.name,
        full_name: repo.full_name,
        description: repo.description || '',
        
        // 分类与标签
        category,
        topics: repo.topics || [],
        tags: extractTags(repo, readme),
        
        // 统计
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        watchers: repo.watchers_count,
        open_issues: repo.open_issues_count,
        
        // 时间
        created_at: repo.created_at,
        updated_at: repo.pushed_at,
        
        // 技术
        language: repo.language,
        license: repo.license?.spdx_id || 'UNKNOWN',
        
        // 安装
        install_cmd: getInstallCommand(repo),
        repo_url: repo.html_url,
        homepage: repo.homepage || null,
        
        // 信任标记
        verified: Boolean(manifest),  // 有 manifest = 通过格式校验
        has_readme: Boolean(readme),
        
        // 快照
        snapshot_commit: repo.default_branch,
      };
      
      plugins.push(plugin);
      
      // 礼貌延迟
      if (CONFIG.requestDelay > 0) await sleep(CONFIG.requestDelay);
      
    } catch (err) {
      errors.push({ repo: repo.full_name, error: err.message });
      console.warn(`   ⚠️  跳过 ${repo.full_name}: ${err.message}`);
    }
  }
  
  // Step 3: 排序
  plugins.sort((a, b) => {
    // 优先 verified
    if (a.verified !== b.verified) return a.verified ? -1 : 1;
    // 其次 stars
    return b.stars - a.stars;
  });
  
  // Step 4: 生成统计
  const stats = {
    total: plugins.length,
    verified: plugins.filter(p => p.verified).length,
    by_category: {},
    by_language: {},
    by_license: {},
  };
  for (const p of plugins) {
    stats.by_category[p.category] = (stats.by_category[p.category] || 0) + 1;
    if (p.language) stats.by_language[p.language] = (stats.by_language[p.language] || 0) + 1;
    stats.by_license[p.license] = (stats.by_license[p.license] || 0) + 1;
  }
  
  // Step 5: 写入文件
  await fs.mkdir(CATALOG_DIR, { recursive: true });
  
  const output = {
    meta: {
      updated_at: new Date().toISOString(),
      source: 'github:topic:dsh-plugin',
      count: plugins.length,
      stats,
    },
    plugins,
  };
  
  await fs.writeFile(
    path.join(CATALOG_DIR, 'plugins.json'),
    JSON.stringify(output, null, 2)
  );
  
  // 写入仓库原始数据（精简版）
  const repos_slim = repos.map(r => ({
    full_name: r.full_name,
    stars: r.stargazers_count,
    updated_at: r.pushed_at,
    topics: r.topics || [],
  }));
  await fs.writeFile(
    path.join(CATALOG_DIR, 'repositories.json'),
    JSON.stringify({ count: repos_slim.length, repositories: repos_slim }, null, 2)
  );
  
  // 写入快照 commit
  await fs.writeFile(
    path.join(CATALOG_DIR, 'snapshot-commit.txt'),
    `${new Date().toISOString()}\n`
  );
  
  // Step 6: 输出报告
  console.log('\n✅ 同步完成!');
  console.log(`   📦 插件总数: ${plugins.length}`);
  console.log(`   ✔️  Verified: ${stats.verified}`);
  console.log(`   📂 分类:`);
  for (const [cat, count] of Object.entries(stats.by_category).sort((a,b) => b[1]-a[1])) {
    console.log(`      ${cat}: ${count}`);
  }
  console.log(`   🌐 语言:`);
  for (const [lang, count] of Object.entries(stats.by_language).sort((a,b) => b[1]-a[1]).slice(0, 5)) {
    console.log(`      ${lang}: ${count}`);
  }
  if (errors.length > 0) {
    console.log(`   ⚠️  跳过 ${errors.length} 个仓库 (详见日志)`);
  }
}

// ── 工具函数 ──────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function extractTags(repo, readme) {
  const tags = new Set();
  const text = `${repo.description || ''} ${readme}`.toLowerCase();
  
  const tagMap = {
    'typescript': ['typescript', 'ts'],
    'javascript': ['javascript', 'node.js', 'nodejs'],
    'python': ['python', 'py'],
    'rust': ['rust', 'cargo'],
    'go': ['golang', 'go '],
    'vue': ['vue', 'vue.js'],
    'react': ['react', 'react.js'],
    'svelte': ['svelte'],
    'astro': ['astro'],
    'docker': ['docker', 'container'],
    'kubernetes': ['kubernetes', 'k8s'],
    'ai': ['ai', 'llm', 'gpt', 'claude', 'deepseek'],
    'database': ['database', 'sql', 'postgres', 'mysql', 'sqlite'],
    'auth': ['auth', 'oauth', 'jwt', 'login'],
    'realtime': ['realtime', 'websocket', 'socket.io'],
  };
  
  for (const [tag, keywords] of Object.entries(tagMap)) {
    for (const kw of keywords) {
      if (text.includes(kw)) {
        tags.add(tag);
        break;
      }
    }
  }
  
  return Array.from(tags);
}

main().catch(err => {
  console.error('❌ 同步失败:', err);
  process.exit(1);
});
```

### 5.2 `scripts/validate.mjs`

```javascript
#!/usr/bin/env node
/**
 * 校验 catalog/plugins.json 数据完整性
 * 运行：npm run validate
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const CATALOG = path.resolve('catalog/plugins.json');

async function main() {
  const raw = await fs.readFile(CATALOG, 'utf-8');
  const data = JSON.parse(raw);
  
  const errors = [];
  const warnings = [];
  
  // 检查结构
  if (!data.meta) errors.push('缺少 meta 字段');
  if (!Array.isArray(data.plugins)) errors.push('plugins 不是数组');
  
  // 检查每个插件
  const seen = new Set();
  for (const p of data.plugins) {
    // 必需字段
    if (!p.full_name) errors.push(`插件缺少 full_name`);
    if (!p.description) warnings.push(`${p.full_name}: 缺少描述`);
    if (!p.install_cmd) warnings.push(`${p.full_name}: 缺少安装命令`);
    if (!p.category) warnings.push(`${p.full_name}: 缺少分类`);
    
    // 重复检查
    if (seen.has(p.full_name)) errors.push(`重复插件: ${p.full_name}`);
    seen.add(p.full_name);
    
    // URL 格式
    if (p.repo_url && !p.repo_url.startsWith('https://github.com/')) {
      warnings.push(`${p.full_name}: repo_url 格式异常`);
    }
  }
  
  // 输出报告
  console.log(`📊 校验报告`);
  console.log(`   插件数: ${data.plugins.length}`);
  console.log(`   错误: ${errors.length}`);
  console.log(`   警告: ${warnings.length}`);
  
  if (warnings.length > 0) {
    console.log('\n⚠️  警告:');
    warnings.slice(0, 10).forEach(w => console.log(`   - ${w}`));
  }
  
  if (errors.length > 0) {
    console.error('\n❌ 错误:');
    errors.forEach(e => console.error(`   - ${e}`));
    process.exit(1);
  }
  
  console.log('\n✅ 校验通过');
}

main().catch(err => {
  console.error('❌ 校验失败:', err);
  process.exit(1);
});
```

---

## 六、前端站点 (Astro)

### 6.1 `site/package.json`

```json
{
  "name": "dsh-hub-site",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview"
  },
  "dependencies": {
    "astro": "^4.0.0"
  }
}
```

### 6.2 `site/astro.config.mjs`

```javascript
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://your-domain.com',  // ← 替换为你的自定义域名
  output: 'static',
  
  // 构建时注入环境变量
  env: {
    schema: {
      PUBLIC_SITE_NAME: { default: 'DSH Plugins Nav' },
      PUBLIC_API_BASE: { default: 'https://your-domain.com' },
    }
  },
  
  // 集成
  integrations: [],
  
  // 构建优化
  build: {
    inlineStylesheets: 'auto',
  },
  
  // 压缩
  compressHTML: true,
});
```

### 6.3 `site/src/pages/index.astro` (首页)

```astro
---
import { plugins, stats } from '../../../catalog/plugins.json';
import Layout from '../components/Layout.astro';
import PluginCard from '../components/PluginCard.astro';
import SearchBar from '../components/SearchBar.astro';
import CategoryFilter from '../components/CategoryFilter.astro';

// 构建时数据已注入
const allPlugins = plugins;
const categories = Object.entries(stats.by_category).sort((a, b) => b[1] - a[1]);
---

<Layout title="DSH Plugins Nav — DeepSeek Harness 插件导航">
  <main class="container">
    <!-- 头部 -->
    <header class="hero">
      <h1>🔌 DSH Plugins Nav</h1>
      <p class="subtitle">
        DeepSeek Harness 插件导航 · 共 <strong>{allPlugins.length}</strong> 个插件 · 
        更新于 <time datetime={stats.updated_at}>{new Date(stats.updated_at).toLocaleString('zh-CN')}</time>
      </p>
      
      <!-- 搜索 -->
      <SearchBar />
      
      <!-- 分类 -->
      <CategoryFilter categories={categories} />
    </header>
    
    <!-- 快捷标签 -->
    <section class="quick-tabs">
      <button data-filter="all" class="active">全部</button>
      <button data-filter="verified">✔️ Verified</button>
      <button data-filter="trending">🔥 Trending</button>
      <button data-filter="new">🆕 New</button>
      <button data-filter="updated">🔄 Updated</button>
    </section>
    
    <!-- 插件列表 -->
    <section class="plugin-grid" id="plugin-grid">
      {allPlugins.map(plugin => (
        <PluginCard plugin={plugin} />
      ))}
    </section>
    
    <!-- 页脚 -->
    <footer>
      <p>
        数据来源: <a href="https://github.com/topics/dsh-plugin">GitHub topic:dsh-plugin</a> · 
        公共 API: <a href="/api/plugins.json">/api/plugins.json</a> · 
        <a href="https://github.com/your-username/dsh-hub">GitHub</a>
      </p>
      <p class="disclaimer">
        ⚠️ Verified 仅表示仓库可达且包含有效清单，非安全审计。安装前请自行审查代码。
      </p>
    </footer>
  </main>
</Layout>

<script>
  // 客户端搜索 + 筛选逻辑
  const searchInput = document.getElementById('search-input');
  const filterBtns = document.querySelectorAll('.quick-tabs button');
  const cards = document.querySelectorAll('.plugin-card');
  
  let currentFilter = 'all';
  let currentSearch = '';
  
  function applyFilter() {
    cards.forEach(card => {
      const name = card.dataset.name || '';
      const desc = card.dataset.desc || '';
      const tags = card.dataset.tags || '';
      const verified = card.dataset.verified === 'true';
      const isNew = card.dataset.isNew === 'true';
      const isUpdated = card.dataset.isUpdated === 'true';
      
      let matchFilter = true;
      if (currentFilter === 'verified') matchFilter = verified;
      if (currentFilter === 'new') matchFilter = isNew;
      if (currentFilter === 'updated') matchFilter = isUpdated;
      if (currentFilter === 'trending') matchFilter = parseInt(card.dataset.stars || '0') > 50;
      
      const matchSearch = !currentSearch || 
        name.includes(currentSearch) || 
        desc.includes(currentSearch) || 
        tags.includes(currentSearch);
      
      card.style.display = (matchFilter && matchSearch) ? '' : 'none';
    });
  }
  
  searchInput?.addEventListener('input', e => {
    currentSearch = e.target.value.toLowerCase().trim();
    applyFilter();
  });
  
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      applyFilter();
    });
  });
</script>

<style>
  .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
  .hero { text-align: center; margin-bottom: 2rem; }
  .hero h1 { font-size: 2.5rem; margin-bottom: 0.5rem; }
  .subtitle { color: #666; margin-bottom: 1.5rem; }
  .quick-tabs { display: flex; gap: 0.5rem; margin-bottom: 2rem; flex-wrap: wrap; }
  .quick-tabs button {
    padding: 0.5rem 1rem; border: 1px solid #ddd; border-radius: 6px;
    background: white; cursor: pointer; transition: all 0.2s;
  }
  .quick-tabs button.active { background: #0070f3; color: white; border-color: #0070f3; }
  .plugin-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 1rem;
  }
  footer { margin-top: 4rem; padding: 2rem 0; border-top: 1px solid #eee; text-align: center; }
  .disclaimer { color: #999; font-size: 0.85rem; margin-top: 0.5rem; }
</style>
```

### 6.4 `site/src/components/PluginCard.astro`

```astro
---
const { plugin } = Astro.props;
const isNew = (Date.now() - new Date(plugin.created_at).getTime()) < 7 * 86400000;
const isUpdated = (Date.now() - new Date(plugin.updated_at).getTime()) < 3 * 86400000;
---

<article 
  class="plugin-card"
  data-name={plugin.name.toLowerCase()}
  data-desc={plugin.description.toLowerCase()}
  data-tags={plugin.topics.join(' ').toLowerCase()}
  data-verified={plugin.verified}
  data-stars={plugin.stars}
  data-is-new={isNew}
  data-is-updated={isUpdated}
>
  <header>
    <h3>
      <a href={`/plugin/${plugin.slug}`}>{plugin.name}</a>
      {plugin.verified && <span class="badge verified" title="已校验">✔️</span>}
      {isNew && <span class="badge new">🆕</span>}
      {isUpdated && <span class="badge updated">🔄</span>}
    </h3>
    <p class="category">{plugin.category}</p>
  </header>
  
  <p class="description">{plugin.description}</p>
  
  <div class="meta">
    <span>⭐ {plugin.stars}</span>
    <span>📝 {plugin.language || 'N/A'}</span>
    <span>📄 {plugin.license}</span>
  </div>
  
  <div class="install">
    <code>{plugin.install_cmd}</code>
    <button class="copy-btn" onclick={`navigator.clipboard.writeText('${plugin.install_cmd}')`}>
      📋
    </button>
  </div>
  
  <footer>
    <a href={plugin.repo_url} target="_blank" rel="noopener">GitHub →</a>
    {plugin.homepage && <a href={plugin.homepage} target="_blank" rel="noopener">主页 →</a>}
  </footer>
</article>

<style>
  .plugin-card {
    border: 1px solid #e0e0e0; border-radius: 8px; padding: 1rem;
    background: white; transition: box-shadow 0.2s;
  }
  .plugin-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
  .plugin-card h3 { margin: 0 0 0.25rem; font-size: 1.1rem; }
  .plugin-card h3 a { color: #0070f3; text-decoration: none; }
  .badge { font-size: 0.8rem; margin-left: 0.25rem; }
  .category { color: #666; font-size: 0.85rem; margin: 0 0 0.5rem; }
  .description { font-size: 0.9rem; color: #333; margin: 0.5rem 0; }
  .meta { display: flex; gap: 1rem; font-size: 0.85rem; color: #666; margin: 0.5rem 0; }
  .install { 
    display: flex; align-items: center; gap: 0.5rem;
    background: #f5f5f5; padding: 0.5rem; border-radius: 4px; margin: 0.5rem 0;
  }
  .install code { flex: 1; font-size: 0.8rem; word-break: break-all; }
  .copy-btn { 
    background: none; border: none; cursor: pointer; font-size: 1rem;
    padding: 0.25rem;
  }
  .plugin-card footer { margin-top: 0.5rem; display: flex; gap: 1rem; }
  .plugin-card footer a { font-size: 0.85rem; color: #0070f3; }
</style>
```

### 6.5 `site/src/components/SearchBar.astro`

```astro
---
// 搜索栏组件
---

<div class="search-bar">
  <input 
    type="search" 
    id="search-input"
    placeholder="🔍 搜索插件名称、描述、标签..."
    autocomplete="off"
  />
  <select id="sort-select">
    <option value="stars">按 Stars 排序</option>
    <option value="updated">按更新时间排序</option>
    <option value="name">按名称排序</option>
    <option value="issues">按活跃度排序</option>
  </select>
</div>

<style>
  .search-bar {
    display: flex; gap: 0.5rem; margin: 1rem 0;
  }
  .search-bar input {
    flex: 1; padding: 0.75rem 1rem; border: 1px solid #ddd;
    border-radius: 8px; font-size: 1rem; outline: none;
  }
  .search-bar input:focus { border-color: #0070f3; }
  .search-bar select {
    padding: 0.75rem; border: 1px solid #ddd; border-radius: 8px;
    font-size: 0.9rem; background: white;
  }
</style>

<script>
  const sortSelect = document.getElementById('sort-select');
  sortSelect?.addEventListener('change', e => {
    const sortBy = e.target.value;
    const grid = document.getElementById('plugin-grid');
    const cards = Array.from(grid.querySelectorAll('.plugin-card'));
    
    cards.sort((a, b) => {
      if (sortBy === 'stars') return parseInt(b.dataset.stars) - parseInt(a.dataset.stars);
      if (sortBy === 'name') return a.dataset.name.localeCompare(b.dataset.name);
      if (sortBy === 'updated') return a.dataset.isUpdated === 'true' ? -1 : 1;
      if (sortBy === 'issues') return 0; // 可扩展
      return 0;
    });
    
    cards.forEach(card => grid.appendChild(card));
  });
</script>
```

### 6.6 `site/src/components/CategoryFilter.astro`

```astro
---
const { categories } = Astro.props;
---

<nav class="category-filter">
  <button class="cat-btn active" data-cat="all">全部分类</button>
  {categories.map(([name, count]) => (
    <button class="cat-btn" data-cat={name}>
      {name} <span class="count">{count}</span>
    </button>
  ))}
</nav>

<style>
  .category-filter {
    display: flex; gap: 0.5rem; flex-wrap: wrap; margin: 1rem 0;
  }
  .cat-btn {
    padding: 0.4rem 0.8rem; border: 1px solid #ddd; border-radius: 20px;
    background: white; cursor: pointer; font-size: 0.85rem; transition: all 0.2s;
  }
  .cat-btn:hover { border-color: #0070f3; color: #0070f3; }
  .cat-btn.active { background: #0070f3; color: white; border-color: #0070f3; }
  .count { 
    background: rgba(0,0,0,0.1); padding: 0.1rem 0.4rem; border-radius: 10px; 
    font-size: 0.75rem; margin-left: 0.25rem;
  }
  .cat-btn.active .count { background: rgba(255,255,255,0.3); }
</style>

<script>
  const catBtns = document.querySelectorAll('.cat-btn');
  const cards = document.querySelectorAll('.plugin-card');
  
  catBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      catBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const cat = btn.dataset.cat;
      
      cards.forEach(card => {
        if (cat === 'all') {
          card.style.display = '';
        } else {
          // 通过 data-tags 或 category 匹配
          const cardCat = card.querySelector('.category')?.textContent || '';
          const match = cardCat.toLowerCase().includes(cat.toLowerCase());
          card.style.display = match ? '' : 'none';
        }
      });
    });
  });
</script>
```

### 6.7 `site/src/components/Layout.astro`

```astro
---
const { title = 'DSH Plugins Nav' } = Astro.props;
---

<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="DeepSeek Harness 插件导航站 — 自动同步、分类浏览、一键安装" />
  <meta name="keywords" content="DeepSeek Harness, DSH, 插件, plugin, navigation" />
  
  <!-- Open Graph -->
  <meta property="og:title" content={title} />
  <meta property="og:description" content="DeepSeek Harness 插件导航站" />
  <meta property="og:type" content="website" />
  
  <!-- Favicon -->
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  
  <!-- Dark mode -->
  <script is:inline>
    const theme = localStorage.getItem('theme') || 'light';
    document.documentElement.classList.toggle('dark', theme === 'dark');
  </script>
  
  <title>{title}</title>
</head>
<body>
  <slot />
  
  <!-- Dark mode toggle -->
  <button id="theme-toggle" aria-label="切换主题">🌙</button>
  
  <script is:inline>
    const btn = document.getElementById('theme-toggle');
    btn.addEventListener('click', () => {
      const isDark = document.documentElement.classList.toggle('dark');
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
      btn.textContent = isDark ? '☀️' : '🌙';
    });
  </script>
  
  <style is:inline>
    :root {
      --bg: #ffffff; --text: #1a1a1a; --border: #e0e0e0;
      --primary: #0070f3; --bg-secondary: #f8f9fa;
    }
    :root.dark {
      --bg: #1a1a1a; --text: #e0e0e0; --border: #333;
      --primary: #3291ff; --bg-secondary: #252525;
    }
    body { 
      margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg); color: var(--text); transition: background 0.3s, color 0.3s;
    }
    #theme-toggle {
      position: fixed; bottom: 1rem; right: 1rem; width: 44px; height: 44px;
      border-radius: 50%; border: 1px solid var(--border); background: var(--bg);
      cursor: pointer; font-size: 1.2rem; z-index: 100;
    }
    a { color: var(--primary); }
  </style>
</body>
</html>
```

### 6.8 公共 API 端点 — `site/src/pages/api/plugins.json.ts`

```typescript
/**
 * 公共 API：返回插件数据 JSON
 * 访问：https://your-domain.com/api/plugins.json
 * 
 * 支持查询参数：
 *   ?category=web-ui    按分类过滤
 *   ?verified=true      仅返回 verified 插件
 *   ?search=keyword     搜索
 *   ?sort=stars         排序方式
 *   ?limit=50           限制数量
 */

import type { APIRoute } from 'astro';
import pluginsData from '../../../../catalog/plugins.json';

export const GET: APIRoute = ({ url }) => {
  const params = url.searchParams;
  
  let plugins = [...pluginsData.plugins];
  
  // 分类过滤
  const category = params.get('category');
  if (category) {
    plugins = plugins.filter(p => p.category === category);
  }
  
  // Verified 过滤
  if (params.get('verified') === 'true') {
    plugins = plugins.filter(p => p.verified);
  }
  
  // 搜索
  const search = params.get('search')?.toLowerCase();
  if (search) {
    plugins = plugins.filter(p =>
      p.name.toLowerCase().includes(search) ||
      p.description.toLowerCase().includes(search) ||
      p.topics.some(t => t.toLowerCase().includes(search))
    );
  }
  
  // 排序
  const sort = params.get('sort') || 'stars';
  switch (sort) {
    case 'stars': plugins.sort((a, b) => b.stars - a.stars); break;
    case 'updated': plugins.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()); break;
    case 'name': plugins.sort((a, b) => a.name.localeCompare(b.name)); break;
    case 'new': plugins.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()); break;
  }
  
  // 限制
  const limit = parseInt(params.get('limit') || '0');
  if (limit > 0) plugins = plugins.slice(0, limit);
  
  const response = {
    meta: {
      ...pluginsData.meta,
      filtered_count: plugins.length,
      query: { category, verified: params.get('verified'), search, sort, limit },
    },
    plugins,
  };
  
  return new Response(JSON.stringify(response, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // CORS 头由 _headers 文件统一处理
    },
  });
};
```

### 6.9 插件详情页 — `site/src/pages/plugin/[slug].astro`

```astro
---
import Layout from '../../components/Layout.astro';
import { plugins } from '../../../../catalog/plugins.json';

export function getStaticPaths() {
  return plugins.map(plugin => ({
    params: { slug: plugin.slug },
    props: { plugin },
  }));
}

const { plugin } = Astro.props;
const isNew = (Date.now() - new Date(plugin.created_at).getTime()) < 7 * 86400000;
---

<Layout title={`${plugin.name} — DSH Plugins Nav`}>
  <main class="container">
    <a href="/" class="back">← 返回首页</a>
    
    <article class="plugin-detail">
      <header>
        <h1>
          {plugin.name}
          {plugin.verified && <span class="badge verified">✔️ Verified</span>}
          {isNew && <span class="badge new">🆕 New</span>}
        </h1>
        <p class="description">{plugin.description}</p>
      </header>
      
      <section class="info-grid">
        <div><strong>分类</strong><span>{plugin.category}</span></div>
        <div><strong>语言</strong><span>{plugin.language || 'N/A'}</span></div>
        <div><strong>许可证</strong><span>{plugin.license}</span></div>
        <div><strong>Stars</strong><span>⭐ {plugin.stars}</span></div>
        <div><strong>更新时间</strong><span>{new Date(plugin.updated_at).toLocaleDateString('zh-CN')}</span></div>
        <div><strong>创建时间</strong><span>{new Date(plugin.created_at).toLocaleDateString('zh-CN')}</span></div>
      </section>
      
      <section class="install-section">
        <h2>安装命令</h2>
        <div class="install-box">
          <code>{plugin.install_cmd}</code>
          <button onclick={`navigator.clipboard.writeText('${plugin.install_cmd}')`}>
            复制
          </button>
        </div>
      </section>
      
      {plugin.topics.length > 0 && (
        <section class="topics">
          <h2>标签</h2>
          <div class="topic-list">
            {plugin.topics.map(t => <span class="topic-tag">{t}</span>)}
          </div>
        </section>
      )}
      
      <section class="links">
        <a href={plugin.repo_url} target="_blank" rel="noopener" class="btn">📦 GitHub 仓库</a>
        {plugin.homepage && <a href={plugin.homepage} target="_blank" rel="noopener" class="btn">🌐 主页</a>}
      </section>
      
      <section class="disclaimer">
        <p>
          ⚠️ <strong>安全提示</strong>：安装前请审查插件源代码。
          Verified 标记仅表示仓库可达且包含有效清单，不构成安全审计。
        </p>
      </section>
    </article>
  </main>
</Layout>

<style>
  .container { max-width: 800px; margin: 0 auto; padding: 2rem; }
  .back { display: inline-block; margin-bottom: 1rem; color: var(--primary); }
  .plugin-detail h1 { font-size: 2rem; margin-bottom: 0.5rem; }
  .description { font-size: 1.1rem; color: #555; margin-bottom: 2rem; }
  .info-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem; margin-bottom: 2rem;
  }
  .info-grid > div {
    padding: 0.75rem; background: var(--bg-secondary); border-radius: 6px;
  }
  .info-grid strong { display: block; font-size: 0.8rem; color: #666; margin-bottom: 0.25rem; }
  .install-box {
    display: flex; align-items: center; gap: 0.5rem;
    background: #1a1a1a; color: #fff; padding: 1rem; border-radius: 8px;
  }
  .install-box code { flex: 1; font-size: 0.95rem; }
  .install-box button {
    padding: 0.5rem 1rem; background: #0070f3; color: white; border: none;
    border-radius: 4px; cursor: pointer;
  }
  .topic-list { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .topic-tag {
    padding: 0.25rem 0.75rem; background: var(--bg-secondary); border-radius: 12px;
    font-size: 0.85rem;
  }
  .links { display: flex; gap: 1rem; margin: 2rem 0; }
  .btn {
    padding: 0.75rem 1.5rem; background: var(--primary); color: white;
    border-radius: 6px; text-decoration: none; font-weight: 500;
  }
  .disclaimer {
    margin-top: 2rem; padding: 1rem; background: #fff3cd; border-radius: 6px;
    border-left: 4px solid #ffc107;
  }
</style>
```

---

## 七、Cloudflare 配置文件

### 7.1 `wrangler.toml`

```toml
# Cloudflare Pages 项目配置
name = "dsh-hub"
pages_build_output_dir = "site/dist"

# 兼容性
compatibility_date = "2026-01-01"

# 环境变量（构建时注入）
[vars]
SITE_NAME = "DSH Plugins Nav"
API_VERSION = "1.0.0"

# 如果未来需要 KV（数据/代码分离架构）
# [[kv_namespaces]]
# binding = "PLUGIN_DATA"
# id = "your-kv-namespace-id"
# preview_id = "your-kv-preview-id"

# 如果未来需要 D1 数据库
# [[d1_databases]]
# binding = "DB"
# database_name = "dsh-plugins"
# database_id = "your-d1-database-id"
```

### 7.2 `_headers`（CORS + 安全头）

```headers
# ============================================================
# 公共 API：允许第三方跨域调用
# ============================================================
/api/*
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, OPTIONS
  Access-Control-Allow-Headers: Content-Type, Authorization
  Access-Control-Max-Age: 86400
  Cache-Control: public, max-age=300, s-maxage=3600
  X-Content-Type-Options: nosniff

# API 预检请求
/api/*
  Access-Control-Max-Age: 86400

# ============================================================
# 静态资源：长期缓存 + 跨域允许
# ============================================================
/assets/*
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=31536000, immutable

/_astro/*
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=31536000, immutable

# ============================================================
# 全局安全头
# ============================================================
/* 
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), camera=(), microphone=()
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload

# ============================================================
# 防止 *.pages.dev 被搜索引擎重复索引
# （绑定自定义域名后，搜索引擎应只索引自定义域名）
# ============================================================
https://dsh-hub.pages.dev/*
  X-Robots-Tag: noindex, nofollow

# ============================================================
# robots.txt 友好
# ============================================================
/robots.txt
  Content-Type: text/plain
```

### 7.3 `_redirects`

```redirects
# 旧 URL → 新 URL
# /old-path/* /new-path/* 301

# SPA fallback (如果需要)
# /* /index.html 200

# API 别名
/api/v1/plugins /api/plugins.json 302
/api/v1/stats  /api/plugins.json 302
```

### 7.4 `robots.txt`

```txt
User-agent: *
Allow: /

# 允许爬取 API（让第三方发现你的开放接口）
Allow: /api/

# Sitemap
Sitemap: https://your-domain.com/sitemap.xml
```

---

## 八、根目录配置文件

### 8.1 `package.json`（仓库根目录）

```json
{
  "name": "dsh-hub",
  "version": "1.0.0",
  "description": "DeepSeek Harness 插件导航站 — 自动同步、分类浏览、开放 API",
  "private": true,
  "type": "module",
  "scripts": {
    "sync": "node scripts/sync.mjs",
    "validate": "node scripts/validate.mjs",
    "check": "npm run validate",
    "build": "cd site && npm install && npm run build",
    "dev": "cd site && npm run dev",
    "deploy": "wrangler pages deploy site/dist --project-name=dsh-hub"
  },
  "devDependencies": {
    "wrangler": "^3.0.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

### 8.2 `.gitignore`

```gitignore
# Dependencies
node_modules/
site/node_modules/

# Build output
site/dist/

# Environment
.env
.env.local

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db

# Logs
*.log
```

### 8.3 `README.md`

```markdown
# 🔌 DSH Plugins Nav

> DeepSeek Harness 插件导航站 — 自动同步 · 分类浏览 · 一键安装 · 开放 API

[![Deploy Status](https://img.shields.io/github/actions/workflow/status/your-username/dsh-hub/deploy.yml?label=deploy)](https://github.com/your-username/dsh-hub/actions)
[![Sync Status](https://img.shields.io/github/actions/workflow/status/your-username/dsh-hub/sync.yml?label=sync)](https://github.com/your-username/dsh-hub/actions)
[![Plugins](https://img.shields.io/endpoint?url=https://your-domain.com/api/plugins.json&label=plugins)](https://your-domain.com)

## ✨ 功能

- 🔍 **自动发现**：每天定时抓取 GitHub `topic:dsh-plugin` 全部仓库
- 📂 **分类浏览**：13 个分类维度，快速定位所需插件
- 🔎 **即时搜索**：客户端搜索 + 服务端 API 过滤
- 📋 **一键复制**：安装命令一键复制到剪贴板
- 🌐 **开放 API**：第三方可跨域调用 `https://your-domain.com/api/plugins.json`
- 🌙 **暗色模式**：自动适配系统主题
- 📱 **移动端适配**：响应式设计，手机端完美浏览

## 🚀 快速开始

### 使用

```bash
# 安装任意插件
dsh plugin --profile web add github:owner/repo
```

### API 调用

```javascript
// 获取全部插件
fetch('https://your-domain.com/api/plugins.json')
  .then(r => r.json())
  .then(data => console.log(`${data.meta.count} 个插件`));

// 按分类过滤
fetch('https://your-domain.com/api/plugins.json?category=web-ui&verified=true')
  .then(r => r.json());

// 搜索
fetch('https://your-domain.com/api/plugins.json?search=vision&sort=stars')
  .then(r => r.json());
```

## 🏗️ 架构

```
GitHub Actions (每天 09:17)
    │
    ▼
scripts/sync.mjs → catalog/plugins.json
    │
    ▼ (有变化时 git push)
Cloudflare Pages (自动构建 + 全球 CDN)
    │
    ▼
公开访问: https://your-domain.com
公共 API: https://your-domain.com/api/plugins.json
```

## 📄 License

MIT
```

---

## 九、自定义域名绑定

### 9.1 前置条件

1. 已拥有一个域名（如 `your-domain.com`）
2. 域名 DNS 托管在 Cloudflare（免费）
3. Cloudflare Pages 项目已创建

### 9.2 绑定步骤

```
Step 1: 域名添加到 Cloudflare
  Cloudflare 控制台 → Add a Site → 输入域名 → 按提示修改 NS 记录

Step 2: Pages 项目绑定域名
  Cloudflare 控制台 → Pages → dsh-hub → Custom domains
  → Set up a custom domain → 输入 your-domain.com
  → Cloudflare 自动添加 CNAME 和 SSL 证书

Step 3: 验证 DNS 生效
  dig your-domain.com CNAME
  # 应返回 dsh-hub.pages.dev

Step 4: 更新站点配置
  修改 site/astro.config.mjs 中的 site 为 'https://your-domain.com'
  修改 README.md 中的域名引用
  修改 _headers 中的 pages.dev 规则（如有必要）
```

### 9.3 DNS 记录示例

| 类型 | 名称 | 内容 | 代理状态 |
|---|---|---|---|
| CNAME | your-domain.com | dsh-hub.pages.dev | 🟠 Proxied |
| CNAME | www.your-domain.com | dsh-hub.pages.dev | 🟠 Proxied |

> 💡 **Proxy 状态必须为 Proxied（橙色云朵）**，这样 Cloudflare CDN、WAF、Rate Limiting 才会生效。

---

## 十、免费额度核算

### 10.1 Cloudflare Pages Free 套餐

| 资源 | 免费额度 | 本项目预估用量 | 占用比 |
|---|---|---|---|
| 每月构建次数 | 500 次 | 30 次/月 (每天1次) | **6%** |
| 单次构建超时 | 20 分钟 | 2-5 分钟 | 安全 |
| 自定义域名 | 100 个/项目 | 1 个 | 1% |
| 站点文件数 | 20,000 个 | < 100 个 | < 1% |
| 单文件大小 | 25 MiB | < 1 MiB | 安全 |
| **静态请求** | **无限** | 取决于流量 | — |
| Pages Functions | 10 万次/天 | API 调用量 | 见下方 |
| KV 读 | 10 万次/天 | 未使用 | 0% |
| D1 存储 | 5 GB | 未使用 | 0% |

### 10.2 GitHub Actions 免费额度

| 资源 | 公共仓库 | 本项目预估 | 占用比 |
|---|---|---|---|
| 运行时间 | 2000 分钟/月 | 60-90 分钟/月 | **3-5%** |
| 并发任务 | 20 个 | 1-2 个 | 安全 |
| 存储 | 500 MB | < 50 MB | < 10% |

### 10.3 结论

> ✅ **两端完全免费，永久运行，无需绑定信用卡。**
> 即使日均 PV 达到 1 万，Cloudflare 静态请求无限，也完全在免费额度内。
> 只有当 API 调用量超过 10 万次/天时，才需要考虑升级 Workers 套餐（$5/月起）。

---

## 十一、无人值守保障机制

### 11.1 心跳提交（防 60 天静默禁用）

GitHub Actions 的 scheduled workflow 在**仓库 60 天无活动时会自动禁用**。
我们的对策：每周一强制一次空 commit（`sync.yml` 中已实现）。

### 11.2 错误处理

| 异常场景 | 处理方式 |
|---|---|
| GitHub API 限速 | 自动检测 `X-RateLimit-Remaining`，耗尽时等待重置 |
| 网络超时 | 单次失败不中断，记录错误继续处理下一个 |
| 数据校验失败 | `validate.mjs` 报错但**不阻断部署**，旧数据继续服务 |
| Cloudflare 部署失败 | GitHub Actions 标记失败，下次 push 自动重试 |
| Token 过期 | 部署失败 → Telegram 通知 → 手动更新 Token |

### 11.3 监控建议

1. **Cloudflare Web Analytics**：免费、隐私友好，无需额外配置
2. **Telegram Bot 通知**：每次同步结果推送（已实现）
3. **UptimeRobot**：外部监控站点可用性，免费版 50 个监控
4. **GitHub Actions 状态徽章**：README 中展示部署状态

---

## 十二、落地检查清单

### 第一阶段：仓库搭建
- [ ] 创建 GitHub 仓库 `dsh-hub`（公开）
- [ ] 克隆到本地，按本文档结构创建文件
- [ ] 安装依赖：`npm install`
- [ ] 手动运行 `npm run sync` 测试同步
- [ ] 手动运行 `npm run build` 测试构建
- [ ] 提交代码到 main

### 第二阶段：Cloudflare 配置
- [ ] 注册/登录 Cloudflare 账号
- [ ] 创建 API Token（Account / Cloudflare Pages / Edit）
- [ ] 复制 Token 到 GitHub Secrets: `CLOUDFLARE_API_TOKEN`
- [ ] 复制 Account ID 到 GitHub Secrets: `CLOUDFLARE_ACCOUNT_ID`
- [ ] Cloudflare Pages 控制台创建项目 `dsh-hub`
- [ ] 连接 GitHub 仓库（或在 Actions 中用 wrangler 部署）

### 第三阶段：自定义域名
- [ ] 域名 DNS 迁移到 Cloudflare
- [ ] Pages 项目绑定自定义域名
- [ ] 验证 SSL 证书自动签发
- [ ] 更新 `astro.config.mjs` 中的 `site` 为自定义域名
- [ ] 更新 `_headers` 中的域名引用
- [ ] 更新 README 中的域名引用

### 第四阶段：验证闭环
- [ ] 手动触发 `sync.yml`（workflow_dispatch）
- [ ] 观察 Actions 日志：同步 → 提交 → 部署
- [ ] 访问 `https://your-domain.com` 确认站点正常
- [ ] 访问 `https://your-domain.com/api/plugins.json` 确认 API 返回数据
- [ ] 用 `curl` 从外部机器测试 API 可访问
- [ ] 在第三方页面用 `fetch()` 测试 CORS 跨域调用成功

### 第五阶段：监控与运维
- [ ] 配置 Telegram Bot Token（可选）
- [ ] 配置 Cloudflare WAF Rate Limiting（保护 API）
- [ ] 启用 Cloudflare Web Analytics
- [ ] 添加 UptimeRobot 监控（可选）
- [ ] README 添加 GitHub Actions 状态徽章

---

## 十三、API 使用文档（供第三方开发者）

### 13.1 基础 URL

```
https://your-domain.com/api/plugins.json
```

### 13.2 查询参数

| 参数 | 类型 | 说明 | 示例 |
|---|---|---|---|
| `category` | string | 按分类过滤 | `?category=web-ui` |
| `verified` | boolean | 仅返回已校验插件 | `?verified=true` |
| `search` | string | 关键词搜索 | `?search=vision` |
| `sort` | string | 排序方式 | `?sort=stars` |
| `limit` | number | 限制返回数量 | `?limit=50` |

### 13.3 响应格式

```json
{
  "meta": {
    "updated_at": "2026-08-21T09:17:00.000Z",
    "source": "github:topic:dsh-plugin",
    "count": 426,
    "filtered_count": 42,
    "stats": {
      "total": 426,
      "verified": 218,
      "by_category": { "web-ui": 85, "desktop": 42, "...": "..." },
      "by_language": { "TypeScript": 156, "Python": 89, "...": "..." },
      "by_license": { "MIT": 245, "Apache-2.0": 89, "...": "..." }
    },
    "query": { "category": "web-ui", "verified": "true", "...": "..." }
  },
  "plugins": [
    {
      "slug": "owner-plugin-name",
      "name": "Plugin Name",
      "full_name": "owner/plugin-name",
      "description": "插件描述",
      "category": "web-ui",
      "topics": ["web-ui", "typescript", "ai"],
      "tags": ["typescript", "react"],
      "stars": 128,
      "forks": 12,
      "watchers": 8,
      "open_issues": 3,
      "created_at": "2026-01-15T00:00:00Z",
      "updated_at": "2026-08-20T00:00:00Z",
      "language": "TypeScript",
      "license": "MIT",
      "install_cmd": "dsh plugin --profile web add github:owner/plugin-name",
      "repo_url": "https://github.com/owner/plugin-name",
      "homepage": "https://plugin.example.com",
      "verified": true,
      "has_readme": true,
      "snapshot_commit": "main"
    }
  ]
}
```

### 13.4 第三方调用示例

```javascript
// 浏览器端（跨域，CORS 已启用）
async function getPlugins(category) {
  const res = await fetch(`https://your-domain.com/api/plugins.json?category=${category}&sort=stars`);
  const data = await res.json();
  return data.plugins;
}

// Node.js 后端
const https = require('https');
https.get('https://your-domain.com/api/plugins.json?limit=10', res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log(JSON.parse(data)));
});

// Python
import requests
r = requests.get('https://your-domain.com/api/plugins.json?search=vision')
print(f"找到 {r.json()['meta']['filtered_count']} 个视觉相关插件")

// Go
package main
import (
  "encoding/json"
  "fmt"
  "io"
  "net/http"
)
func main() {
  r, _ := http.Get("https://your-domain.com/api/plugins.json?verified=true")
  defer r.Body.Close()
  body, _ := io.ReadAll(r.Body)
  var data map[string]interface{}
  json.Unmarshal(body, &data)
  fmt.Println(data["meta"].(map[string]interface{})["count"])
}
```

---

## 十四、安全与合规

### 14.1 数据安全

- ✅ 不收集用户个人信息
- ✅ 不存储 Cookie（除主题偏好 localStorage）
- ✅ 所有数据来自公开 GitHub API
- ✅ 不代理或缓存敏感内容

### 14.2 插件安全提示

- ⚠️ **Verified 标记 ≠ 安全审计**：仅表示仓库可达 + 清单格式正确
- ⚠️ 安装前请审查插件源代码
- ⚠️ 部分插件可能涉及文件操作、终端访问、API Key 处理
- ⚠️ 建议在隔离环境（容器/虚拟机）中测试新插件

### 14.3 Cloudflare 安全功能（免费可用）

| 功能 | 说明 | 推荐配置 |
|---|---|---|
| WAF | Web 应用防火墙 | 启用托管规则 |
| Rate Limiting | API 速率限制 | 60 req/min/IP |
| DDoS Protection | 自动 DDoS 防护 | 默认启用 |
| SSL/TLS | 免费证书 | 强制 HTTPS (Full Strict) |
| Bot Fight Mode | 简单爬虫拦截 | 启用 |
| Security Headers | XSS/CSRF 防护 | 已在 `_headers` 配置 |

---

## 十五、扩展路线图

### Phase 1 — MVP（本文档实现）
- [x] 自动同步 GitHub topic:dsh-plugin
- [x] 分类浏览 + 搜索 + 排序
- [x] 开放公共 API (CORS)
- [x] 自定义域名 + HTTPS
- [x] 暗色模式 + 移动端适配

### Phase 2 — 增强
- [ ] 插件详情页截图预览（Headless Chrome 截图）
- [ ] 用户评论/评分系统（Cloudflare D1 + Pages Functions）
- [ ] 插件安装统计（匿名聚合）
- [ ] RSS Feed / Newsletter 订阅
- [ ] 多语言支持（中英双语）

### Phase 3 — 高级
- [ ] 数据写入 KV（分离数据/代码，零构建更新）
- [ ] GitHub Webhook 实时同步（有新插件立即更新）
- [ ] 插件安全扫描（自动检测危险权限）
- [ ] 可视化仪表盘（D3.js 图表）
- [ ] MCP Server 模式（让 AI Agent 直接查询插件目录）

---

## 十六、故障排查

### 问题 1：GitHub Actions 定时任务没执行
**原因**：仓库 60 天无活动，定时任务被静默禁用
**解决**：手动触发一次 `workflow_dispatch`，或确保心跳提交正常

### 问题 2：Cloudflare 部署失败
**原因**：API Token 权限不足或过期
**解决**：重新生成 Token，确保有 `Cloudflare Pages:Edit` 权限

### 问题 3：API 返回 404
**原因**：`_headers` 或文件路径配置错误
**解决**：检查 `site/dist/api/plugins.json` 是否存在于构建产物中

### 问题 4：第三方跨域调用被拦截
**原因**：CORS 头未生效
**解决**：确认 `_headers` 文件在 `site/dist/` 根目录，且路径匹配

### 问题 5：自定义域名 HTTPS 报错
**原因**：DNS 未生效或 SSL 证书未签发
**解决**：等待 DNS 传播（最多 48 小时），在 CF 控制台手动触发证书签发

### 问题 6：同步脚本 GitHub API 限速
**原因**：未认证或限额耗尽
**解决**：确保 `GITHUB_TOKEN` Secret 已配置，或在脚本中使用 PAT

---

## 附录：文件目录树

```
dsh-hub/
├── .github/
│   └── workflows/
│       ├── sync.yml              # 每日同步工作流
│       └── deploy.yml            # 部署工作流
├── scripts/
│   ├── sync.mjs                  # 核心同步脚本
│   └── validate.mjs              # 数据校验脚本
├── site/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Layout.astro
│   │   │   ├── PluginCard.astro
│   │   │   ├── SearchBar.astro
│   │   │   └── CategoryFilter.astro
│   │   └── pages/
│   │       ├── index.astro       # 首页
│   │       ├── plugin/
│   │       │   └── [slug].astro  # 详情页
│   │       └── api/
│   │           └── plugins.json.ts # 公共 API
│   ├── package.json
│   └── astro.config.mjs
├── catalog/
│   ├── plugins.json              # 插件主数据 (同步产出)
│   ├── repositories.json         # 仓库元数据 (同步产出)
│   └── snapshot-commit.txt       # 快照标记 (同步产出)
├── _headers                      # CORS + 安全响应头
├── _redirects                    # URL 重定向规则
├── wrangler.toml                 # Cloudflare 部署配置
├── package.json                  # 根目录脚本
├── .gitignore
├── .env.example                  # 环境变量示例
└── README.md
```

---

> 📌 **总结**：这套方案实现了"全自动 + 全部免费 + 无人干预 + 公开访问 + 第三方可跨域调用 API + 自定义域名"。
> 每天北京时间 09:17 自动同步最新插件数据，自动部署到 Cloudflare 全球 CDN，
> 任何人都可以通过浏览器访问，任何第三方应用都可以通过 API 获取数据。
> 心跳机制保障长期无人值守不中断，Cloudflare WAF 保障 API 不被滥用。
> **设一次，跑一年，零成本。**
