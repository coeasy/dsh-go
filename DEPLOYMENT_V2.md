# DSH Plugins Nav — 全自动免费部署方案 V2.0（全面升级版）

> **定位**：DeepSeek Harness 插件市场导航站
> **架构决策**：方案 C —— 纯静态数据 + Pages Functions 动态 API 为主，保留 KV 零构建升级路径
> **核心承诺**：全自动同步 → 自动构建 → 全球 CDN → 真·动态 RESTful API → 任何流量下绝对 0 元

---

## 〇、V2 升级说明（相对 V1 的变化）

### 0.1 V1 的三个硬伤（V2 全部修复）

| # | V1 问题 | 后果 | V2 修复 |
|---|---|---|---|
| 1 | 同步提交使用 `[skip ci]` | GitHub Actions 会跳过**所有**工作流，导致数据推送后**永远不会触发部署**，站点数据永远停在第一次 | 同步提交不带 `[skip ci]`；sync.yml 只由 cron/dispatch 触发（不监听 push），不会形成循环；心跳提交改用 `[no deploy]` 标记，由 deploy.yml 条件跳过 |
| 2 | `api/plugins.json.ts` 在 Astro 静态模式下构建为**静态文件** | `?category=` `?search=` `?sort=` 等参数**在生产环境全部静默失效**，所谓"开放 API"只是伪装成 API 的静态 JSON | API 层改为 **Cloudflare Pages Functions**（真正的服务端代码），支持过滤/搜索/排序/分页/ETag/304，免费 10 万次/天 |
| 3 | 每次同步无条件重写 `updated_at` | 即使插件数据零变化，每天也产生一次无意义 commit + 构建 | 同步脚本做**内容级 diff**：插件数据无变化时不写 plugins/feed（不触发构建）；仅写 meta 心跳并用 `[no deploy]` 提交，deploy.yml 条件跳过，保持线上数据新鲜度检测可用 |

### 0.2 V2 新增能力一览

- **真·RESTful API v1**：8 个路由，过滤/搜索/排序/分页/ETag 协商缓存/统一错误格式/版本化
- **OpenAPI 3.0 规范**：`/openapi.json`，可直接导入 Postman/Apifox
- **MCP 端点**：`/api/v1/mcp`，AI Agent（Claude/DSH 自身）可直接查询插件目录
- **增量同步**：每天 08:18 全量 + 每 6 小时增量（只抓 `pushed:` 变更的仓库），新插件最快 6 小时内上架
- **手动/外部触发刷新**：`repository_dispatch` 一条 curl 立即全量刷新
- **RSS 订阅**：`/feed.xml` 输出新增/更新插件
- **自助监控 + 邮件告警**：每小时健康检查，站点宕机 → 工作流失败 → GitHub 自动发邮件，零第三方服务
- **API 文档页**：`/docs` 站内文档 + 示例代码
- **统计页**：`/stats` 分类/语言/许可证分布可视化（纯 CSS，零 JS 依赖）
- **Sitemap + SEO**：sitemap.xml、OG 标签、结构化数据
- **数据协议 v2**：新增 `first_seen`、`trend_score`、`readme_excerpt`、`etag`

### 0.3 关键决策记录（已确认）

| 决策点 | 选择 | 理由 |
|---|---|---|
| 数据架构 | **方案 C**：静态 + 动态 API 为主，保留 KV 升级路径 | 静态请求无限免费、机制上不可能扣费；数据更新 1~2 分钟自动重建，对导航站无感知；KV 路径在 §13 完整保留 |
| 仓库可见性 | **公开仓库** | Actions 分钟数完全免费无上限；导航站展示的本来就是公开插件 |
| 通知方式 | **邮件**（GitHub 原生） | 零第三方配置：工作流失败自动邮件 + 监控工作流失败邮件（§11） |
| 域名 | **优先免费 `*.pages.dev` 子域名**，随时可绑自定义域名 | 上线零门槛；自定义域名步骤保留在 §14，全部配置用变量占位 |

---

## 一、架构总览（V2）

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          GitHub 公开仓库 (main)                          │
│                                                                         │
│  .github/workflows/                                                     │
│    ├── sync.yml      每日 08:18 全量 + 每 6h 增量 + 手动/dispatch 触发   │
│    ├── deploy.yml    push main 时构建并部署（监听同步提交）              │
│    └── monitor.yml   每小时健康检查，失败自动邮件告警                    │
│                                                                         │
│  scripts/            sync.mjs / validate.mjs / copy-assets.mjs          │
│  catalog/            同步产出：plugins.json / meta.json / feed.xml      │
│  site/               Astro 5 前端 + public/(_headers/_redirects)        │
│  functions/          Pages Functions（API v1 全部端点 + MCP）           │
│  wrangler.toml       Pages 部署配置                                     │
└────────────┬─────────────────────────────────────┬──────────────────────┘
             │ ① 定时/手动触发同步                  │ ② 数据有变化才 push
             ▼                                     ▼
      GitHub Actions                        GitHub Actions
      sync.mjs 抓取+校验                    build + wrangler deploy
      （内容级 diff，无变化不提交）                  │
                                                   ▼
                                   ┌────────────────────────────────┐
                                   │      Cloudflare Pages (免费)    │
                                   │                                │
                                   │  静态层（请求无限，绝对免费）    │
                                   │  ├── /            导航首页      │
                                   │  ├── /plugin/*    详情页       │
                                   │  ├── /catalog/*.json 原始数据   │
                                   │  ├── /feed.xml    RSS          │
                                   │  └── /openapi.json API 规范    │
                                   │                                │
                                   │  Functions 层（10万次/天免费）  │
                                   │  └── /api/v1/*    动态 API     │
                                   │      (env.ASSETS.fetch 读静态  │
                                   │       JSON → 过滤/搜索/分页/   │
                                   │       ETag/304)               │
                                   └────────────────────────────────┘
                                                   │
                       ┌───────────────────────────┼───────────────────────┐
                       ▼                           ▼                       ▼
              浏览器访问（全球 CDN）        第三方 JS/后端调 API      AI Agent 走 MCP
```

### 1.1 双部署：Cloudflare Pages + GitHub Pages 静态镜像

> 本项目支持同时部署到 **Cloudflare Pages（主站，全功能含 API）** 与 **GitHub Pages（静态镜像，无 API）**。
> 两站前端内容完全一致，均自动更新；GitHub Pages 仅供纯静态访问，`/api/*` 不可用但不受影响。

```
GitHub Pages 镜像站 https://<owner>.github.io/<repo>/   Cloudflare 主站 https://dsh-hub.pages.dev
        │  静态页面/插件卡片/搜索（前端过滤）                 │  静态页面 + /api/v1/* 动态 API
        └─ 指向 API 的链接自动跳转 ───────────────────────→  │
```

| 对比项 | Cloudflare Pages（主站） | GitHub Pages（静态镜像） |
|---|---|---|
| 部署域名 | `https://dsh-hub.pages.dev` | `https://coeasy.github.io/dsh_hub/` |
| 部署方式 | `deploy.yml`（assets） | `deploy-pages.yml`（官方 actions） |
| `/api/v1/*` | ✅ Pages Functions 真 API | ❌ 无 functions，自动跳转主站 API |
| 前端功能 | ✅ 完整 | ✅ 完整（纯静态渲染，不依赖 API） |
| 管理级别 | 全自动一条链路 | 全自动，仅依赖 GitHub |

**关键机制（已实现）**：
- `PUBLIC_API_URL` 环境变量分离 API 域名 → GitHub Pages 上所有 API 链接指向 Cloudflare 主站；
- `u()` 工具函数给绝对链接加 `base` 前缀 → 正确适配 `<repo>/` 子路径部署；
- 常规合并提交（不带 `[no deploy]`）同时触发两个工作流，一次性更新两站。

**数据更新链路**：同步脚本产出新 JSON → 校验通过 → 内容有变化才 commit → 自动触发双部署工作流 → 构建（1~2 分钟）→ 两站全球生效。全程无人干预。

**为什么这就是"绝对 0 元"**：
- 页面与数据走**静态资源**，Cloudflare Pages 静态请求无限量、无计费概念；
- API 走 Pages Functions，免费 10 万次/天，**超量只会停止执行（返回错误），不会扣费**，升级付费必须由你手动操作；
- Actions 在公开仓库分钟数无限制；
- 不用 KV、不用 D1、不用 Workers 付费计划、不用任何付费通知服务。

---

## 二、仓库目录结构（V2）

```
dsh-hub/
├── .github/
│   ├── workflows/
│   │   ├── sync.yml                 # 同步（全量+增量+手动+dispatch）
│   │   ├── deploy.yml               # 构建并部署到 Cloudflare Pages（主站）
│   │   ├── deploy-pages.yml         # 构建为纯静态并部署到 GitHub Pages（镜像）
│   │   └── monitor.yml              # 每小时健康检查（失败→邮件告警）
│   └── dependabot.yml               # 依赖安全更新
├── scripts/
│   ├── sync.mjs                     # 核心同步（全量/增量，内容级 diff）
│   ├── validate.mjs                 # 数据校验门禁
│   └── copy-assets.mjs              # 构建前把 catalog/ 拷入 site/public/
├── catalog/                         # 同步产出（提交进 git，是 API 的数据源）
│   ├── plugins.json                 # 插件主数据（协议 v2）
│   ├── meta.json                    # 同步元信息（时间/模式/计数/etag）
│   ├── overrides.json               # 人工覆盖层（名称/描述/分类/隐藏，优先级最高）
│   └── feed.xml                     # RSS（新增+近期更新插件）
├── site/
│   ├── public/
│   │   ├── _headers                 # CORS + 安全头 + 缓存策略
│   │   ├── _redirects               # API 别名/旧路径兼容
│   │   ├── openapi.json             # OpenAPI 3.0 规范
│   │   ├── robots.txt
│   │   ├── favicon.svg
│   │   └── catalog/                 # ← 构建时由 copy-assets.mjs 拷入（.gitignore）
│   ├── src/
│   │   ├── components/              # Layout/PluginCard/SearchBar/CategoryFilter（均已拆分）
│   │   ├── pages/
│   │   │   ├── index.astro          # 首页（搜索/筛选/排序/URL 状态）
│   │   │   ├── plugin/[slug].astro  # 插件详情页
│   │   │   ├── docs.astro           # API 开发者文档页
│   │   │   ├── stats.astro          # 统计可视化页
│   │   │   └── 404.astro
│   │   └── scripts/app.js           # 首页客户端逻辑
│   ├── astro.config.mjs
│   └── package.json
├── functions/                       # Cloudflare Pages Functions（API 层）
│   ├── _lib.ts                      # 公共：数据加载/过滤/错误/分类注册表
│   └── api/v1/
│       ├── plugins.ts               # GET /api/v1/plugins
│       ├── plugins/[slug].ts        # GET /api/v1/plugins/:slug
│       ├── categories.ts            # GET /api/v1/categories
│       ├── stats.ts                 # GET /api/v1/stats
│       ├── search.ts                # GET /api/v1/search?q=
│       ├── health.ts                # GET /api/v1/health
│       ├── meta.ts                  # GET /api/v1/meta
│       └── mcp.ts                   # POST /api/v1/mcp（MCP for AI Agent）
├── wrangler.toml
├── package.json                     # 根脚本（根目录安装依赖，供 Actions 使用）
├── .gitignore
├── README.md
├── CHANGELOG.md
└── DEPLOYMENT_V2.md                 # 本文档
```

---

## 三、数据协议 v2

### 3.1 `catalog/plugins.json`

```json
{
  "version": 2,
  "meta": {
    "updated_at": "2026-08-23T01:17:00.000Z",
    "source": "github:topic:dsh-plugin",
    "count": 426,
    "etag": "a1b2c3d4...(plugins 数组的 sha256 前 16 位)",
    "stats": {
      "total": 426,
      "verified": 218,
      "by_category": { "web-ui": 85, "desktop": 42 },
      "by_language": { "TypeScript": 156 },
      "by_license": { "MIT": 245 }
    }
  },
  "plugins": [ /* 按 verified 降序 + trend_score 降序排列 */ ]
}
```

### 3.2 插件对象字段（v2 新增字段加粗）

| 字段 | 类型 | 说明 |
|---|---|---|
| slug | string | `owner-repo` 形式，全站唯一 |
| name / full_name | string | 显示名 / `owner/repo` |
| description | string | 仓库描述 |
| category | string | 13 分类之一或 `other` |
| topics / tags | string[] | GitHub topics / 从描述推断的技术标签 |
| stars / forks / watchers / open_issues | number | 统计 |
| created_at / updated_at | string | 仓库创建 / 最后推送时间 |
| **first_seen** | string | 本导航站首次收录时间（增量合并时保留旧值，用于"新上架"标识） |
| **trend_score** | number | 热度分 = stars + 新鲜度加权（见 §4.1 公式） |
| language / license | string | 主语言 / SPDX 许可证 |
| install_cmd | string | `dsh plugin --profile <p> add github:owner/repo` |
| repo_url / homepage | string | 仓库 / 主页 |
| verified | boolean | 含有效清单文件 |
| has_readme | boolean | 有 README |
| **readme_excerpt** | string | README 前 500 字符（去标记），详情页展示 |
| snapshot_commit | string | 默认分支名 |

### 3.3 `catalog/meta.json`

```json
{
  "last_sync": {
    "at": "2026-08-23T01:17:00.000Z",
    "mode": "full",
    "duration_ms": 84000,
    "scanned": 452,
    "included": 426,
    "skipped": 26,
    "errors": []
  },
  "history": [ /* 最近 30 次同步摘要，先进先出 */ ]
}
```

---

## 四、GitHub Actions 工作流（V2 修正版）

### 4.1 每日全量 + 每 6 小时增量同步（`.github/workflows/sync.yml`）

```yaml
name: Sync Plugins

on:
  schedule:
    # 全量同步：每日北京时间 08:18（UTC 00:18，避开整点减少队列竞争）
    - cron: "18 0 * * *"
    # 增量同步：每 6 小时，北京时间 14:18 / 20:18 / 02:18
    - cron: "18 6 * * *"    # 北京 14:18
    - cron: "18 12 * * *"   # 北京 20:18
    - cron: "18 18 * * *"   # 北京 02:18
  workflow_dispatch:
    inputs:
      mode:
        description: "同步模式"
        type: choice
        default: full
        options: [full, incremental]
  # 外部系统一条 curl 即可触发刷新（见 §4.4）
  repository_dispatch:
    types: [sync-plugins]

permissions:
  contents: write

concurrency:
  group: sync
  cancel-in-progress: false   # 同步任务串行，不取消正在跑的

jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install dependencies
        run: npm ci

      - name: Resolve sync mode
        id: mode
        run: |
          MODE="${{ github.event.inputs.mode || 'incremental' }}"
          # cron 全量触发点 → full；手动可覆盖；dispatch 默认 full
          if [ "${{ github.event_name }}" = "schedule" ] && [ "${{ github.event.schedule }}" = "18 0 * * *" ]; then
            MODE="full"
          fi
          if [ "${{ github.event_name }}" = "repository_dispatch" ]; then
            MODE="${{ github.event.client_payload.mode || 'full' }}"
          fi
          echo "mode=$MODE" >> $GITHUB_OUTPUT
          echo "同步模式: $MODE"

      - name: Sync plugin data
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          SYNC_MODE: ${{ steps.mode.outputs.mode }}
        run: node scripts/sync.mjs

      - name: Validate catalog (gate)
        run: node scripts/validate.mjs

      - name: Detect changes
        id: diff
        run: |
          # 内容级 diff：脚本只在数据真实变化时才写文件
          if ! git diff --quiet catalog/; then
            echo "changed=true" >> $GITHUB_OUTPUT
          else
            echo "changed=false" >> $GITHUB_OUTPUT
            echo "数据无变化，跳过提交与部署"
          fi

      - name: Commit & push
        if: steps.diff.outputs.changed == 'true'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add catalog/
          COUNT=$(node -p "require('./catalog/plugins.json').meta.count")
          git commit -m "chore(sync): 更新插件目录 (${COUNT} 个插件, ${{ steps.mode.outputs.mode }})"
          git push
          # 注意：这里【不加 [skip ci]】——push 到 main 会自动触发 deploy.yml

      - name: Summary
        if: always()
        run: |
          echo "### 同步报告 (${{ steps.mode.outputs.mode || 'n/a' }})" >> $GITHUB_STEP_SUMMARY
          if [ -f catalog/meta.json ]; then
            node -e "const m=require('./catalog/meta.json');console.log('- 时间: '+m.last_sync.at+'- 收录: '+m.last_sync.included+' / 扫描: '+m.last_sync.scanned+'- 跳过: '+m.last_sync.skipped)" >> $GITHUB_STEP_SUMMARY
          fi
```

> **失败自动邮件**：公开仓库中工作流失败时，GitHub 会默认向仓库 watchers / 提交者发送邮件通知。如需额外保险，可在 Settings → Notifications 中把 "Actions" 设为 "All activity"。这是 GitHub 原生能力，**零第三方、零费用**。

### 4.2 部署工作流（`.github/workflows/deploy.yml`）

```yaml
name: Deploy

on:
  push:
    branches: [main]
    paths-ignore:
      - "**.md"              # 纯文档改动不部署
      - "LICENSE"
  workflow_dispatch:

permissions:
  contents: read
  deployments: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: site/package-lock.json

      - name: Install site dependencies
        run: cd site && npm ci

      - name: Copy catalog into site (API 数据源 + 静态下载)
        run: node scripts/copy-assets.mjs

      - name: Build site
        run: cd site && npm run build

      - name: Verify build output
        run: |
          test -f site/dist/index.html
          test -f site/dist/catalog/plugins.json
          echo "构建产物校验通过"

      - name: Deploy to Cloudflare Pages
        uses: cloudflare/pages-action@v1
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          projectName: dsh-hub
          directory: site/dist
          gitHubToken: ${{ secrets.GITHUB_TOKEN }}
```

### 4.3 监控工作流（`.github/workflows/monitor.yml`）

```yaml
name: Monitor

on:
  schedule:
    - cron: "5 * * * *"     # 每小时第 5 分钟
  workflow_dispatch:

jobs:
  health-check:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Check site homepage
        run: |
          STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "${SITE_URL}/")
          [ "$STATUS" = "200" ] || { echo "首页异常: $STATUS"; exit 1; }
        env:
          SITE_URL: ${{ vars.SITE_URL }}

      - name: Check API
        run: |
          STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "${SITE_URL}/api/v1/health")
          [ "$STATUS" = "200" ] || { echo "API 异常: $STATUS"; exit 1; }
        env:
          SITE_URL: ${{ vars.SITE_URL }}

      - name: Check data freshness
        run: |
          # 数据超过 36 小时未更新视为异常（全量同步应每天 08:18 成功）
          UPDATED=$(curl -s --max-time 20 "${SITE_URL}/api/v1/meta" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).last_sync.at))")
          AGE_H=$(( ( $(date +%s) - $(date -d "$UPDATED" +%s) ) / 3600 ))
          [ "$AGE_H" -lt 36 ] || { echo "数据已 ${AGE_H} 小时未更新"; exit 1; }
          echo "数据新鲜度正常 (${AGE_H}h)"
        env:
          SITE_URL: ${{ vars.SITE_URL }}
```

> 任一检查失败 → 工作流标红 → GitHub 邮件告警（原生能力）。同时 Actions 徽章在 README 上会显示红色，双保险。

### 4.4 外部手动触发（一条 curl 立即刷新）

```bash
# 任何系统（如插件作者的发布脚本）都可以调用：
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  https://api.github.com/repos/<owner>/dsh-hub/dispatches \
  -d '{"event_type":"sync-plugins","client_payload":{"mode":"full"}}'
```

触发后 2~4 分钟内（同步 + 构建 + 部署）新数据全球生效。**仍然是免费的**（走的是同一个 Actions 额度，公开仓库无上限）。

### 4.5 GitHub Pages 静态镜像工作流（`.github/workflows/deploy-pages.yml`）

> 与 §4.2 的 `deploy.yml` 并行工作：同为 push main 触发，但把站点构建为**纯静态产物**，通过官方队列部署到 `https://<owner>.github.io/<repo>/`。GitHub Pages **不提供 functions**，因此镜像站 `/api/v1/*` 不可用；前端为纯静态渲染、不调用 API，功能不受影响，指向 API 的链接经 `PUBLIC_API_URL` 自动跳回 Cloudflare 主站。

```yaml
name: Deploy GitHub Pages

on:
  push:
    branches: [main]
    paths-ignore: ["**.md", "LICENSE"]   # 纯文档改动不触发
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages-deploy
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    if: ${{ github.event_name != 'push' || !contains(github.event.head_commit.message, '[no deploy]') }}
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: site/package-lock.json }
      - run: npm ci && npm run typecheck && npm test
      - run: cd site && npm ci
      - run: node scripts/copy-assets.mjs
      - run: cd site && npm run build
        env:
          PUBLIC_BASE_PATH: /${{ github.event.repository.name }}
          PUBLIC_SITE_URL: https://${{ github.event.repository.owner.login }}.github.io/${{ github.event.repository.name }}
          PUBLIC_API_URL: https://${{ vars.CF_PAGES_PROJECT || 'dsh-hub' }}.pages.dev
      - uses: actions/upload-pages-artifact@v3
        with: { path: site/dist }
      - uses: actions/deploy-pages@v4
        id: deployment
```

**三个环境变量的作用**（GitHub Pages 镜像站必配）：
- `PUBLIC_BASE_PATH`：`/<repo>/` 子路径前缀，`urls.ts` 的 `u()` 据此给所有绝对链接加前缀；
- `PUBLIC_SITE_URL`：canonical/OG/sitemap 指向本站域名，避免两站重复收录；
- `PUBLIC_API_URL`：保持 Cloudflare 主站，因 GitHub Pages 无 functions，`/api/*` 链接自动跳回 `https://<owner>.pages.dev`。

> **启用步骤（一次性）**：
> 1. 仓库 Settings → Pages → **Source** 选 **GitHub Actions**；
> 2. repo Settings → Actions → Workflow permissions → **Read and write**；
> 3. （可选）仓库 Variables 添加 `CF_PAGES_PROJECT = dsh-hub` 覆盖默认主站 API 域名。
>
> 详见 [DEPLOY_GUIDE.md §8 双部署](./DEPLOY_GUIDE.md)。

---

## 五、同步脚本 V2（`scripts/sync.mjs` 核心逻辑）

### 5.1 与 V1 的关键差异

| 能力 | V1 | V2 |
|---|---|---|
| 同步模式 | 仅全量 | **全量 + 增量**（`pushed:>YYYY-MM-DD` 搜索） |
| 变更检测 | 无（每次都写文件） | **内容级 diff**：按 full_name 对比新旧数据，无变化不写 |
| first_seen | 无 | 增量合并时保留旧记录的 first_seen |
| README 摘要 | 无 | 抓取并清洗前 500 字符存入 `readme_excerpt` |
| 请求优化 | 每仓库最多 3 次请求 | 清单走 **raw.githubusercontent**（不占 REST 配额），搜索+readme 走 REST |
| 失败容忍 | 单仓失败跳过 | 同左，且错误写入 `meta.json.errors` |
| RSS | 无 | 自动生成 `catalog/feed.xml` |

### 5.2 增量合并算法

```
1. 搜索 topic:dsh-plugin pushed:>{上次全量时间}（最多 200 条）
2. 对每个命中的仓库：重新抓取元数据 + 清单 + readme
3. 加载旧 catalog/plugins.json：
   - 命中仓库 → 用新数据覆盖（保留旧 first_seen）
   - 未命中仓库 → 原样保留
4. 重新排序、重新统计、重新计算 etag
5. JSON.stringify 后与旧文件比对 → 相同则不写盘
```

### 5.3 trend_score 公式

```
trend_score = stars + 20 × (7 天内有更新 ? 1 : 0) + 10 × (30 天内创建 ? 1 : 0)
```

用于首页 "Trending" 标签的排序依据。

### 5.4 清单获取优化（不占 REST 配额）

```javascript
// 直接走 raw 域名，失败即视为无清单，不消耗 api.github.com 配额
async function fetchManifest(fullName, branch) {
  for (const file of ['dsh-plugin.json', 'package.json']) {
    const url = `https://raw.githubusercontent.com/${fullName}/${branch}/${file}`;
    const res = await fetch(url);
    if (res.ok) return { file, data: await res.json() };
  }
  return null;
}
```

---

## 六、真·API 层：Cloudflare Pages Functions

> **为什么必须用 Functions 而不是静态文件**：Astro 静态构建会把 `api/plugins.json.ts` 渲染成一个固定文件，URL 参数（`?category=web-ui`）完全不起作用。V2 把所有 API 逻辑放进 `functions/` 目录，Cloudflare Pages 自动将其部署为边缘函数，**免费 10 万次/天，超量只停服不扣费**。

### 6.1 API 端点总览（v1）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/plugins` | 插件列表（过滤/搜索/排序/分页） |
| GET | `/api/v1/plugins/:slug` | 单个插件详情 |
| GET | `/api/v1/categories` | 分类注册表（含计数） |
| GET | `/api/v1/stats` | 聚合统计 |
| GET | `/api/v1/search?q=关键词` | 快速搜索（语义化别名） |
| GET | `/api/v1/meta` | 同步元信息（供监控） |
| GET | `/api/v1/health` | 健康检查 |
| POST | `/api/v1/mcp` | MCP 端点（AI Agent 查询） |

所有端点：`Access-Control-Allow-Origin: *`（公共开放）、支持 `If-None-Match` → 304、统一错误格式。

### 6.2 公共库 `functions/_lib.ts`

```typescript
// functions/_lib.ts —— 数据加载与过滤核心
export interface Plugin {
  slug: string; name: string; full_name: string; description: string;
  category: string; topics: string[]; tags: string[];
  stars: number; forks: number; open_issues: number;
  created_at: string; updated_at: string; first_seen: string;
  trend_score: number; language: string; license: string;
  install_cmd: string; repo_url: string; homepage: string | null;
  verified: boolean; readme_excerpt: string;
}

const CACHE = new Map<string, { data: any; etag: string }>();

// 通过静态资源绑定读取 catalog 数据（无需 KV，零成本）
export async function loadCatalog(env: any) {
  const cached = CACHE.get('plugins');
  if (cached) return cached;
  const res = await env.ASSETS.fetch(new URL('/catalog/plugins.json', 'https://internal'));
  if (!res.ok) throw new Error('catalog load failed: ' + res.status);
  const data = await res.json();
  const entry = { data, etag: data.meta.etag };
  CACHE.set('plugins', entry);
  return entry;
}

export interface Query {
  category?: string; verified?: boolean; language?: string; license?: string;
  search?: string; sort?: string; order?: 'asc' | 'desc';
  page?: number; per_page?: number; created_after?: string; updated_after?: string;
}

export function filterPlugins(plugins: Plugin[], q: Query) {
  let list = plugins;
  if (q.category && q.category !== 'all') list = list.filter(p => p.category === q.category);
  if (q.verified === true) list = list.filter(p => p.verified);
  if (q.language) list = list.filter(p => p.language?.toLowerCase() === q.language!.toLowerCase());
  if (q.license) list = list.filter(p => p.license?.toLowerCase() === q.license!.toLowerCase());
  if (q.created_after) list = list.filter(p => p.created_at >= q.created_after!);
  if (q.updated_after) list = list.filter(p => p.updated_at >= q.updated_after!);
  if (q.search) {
    const kw = q.search.toLowerCase();
    list = list.filter(p =>
      p.name.toLowerCase().includes(kw) ||
      p.description.toLowerCase().includes(kw) ||
      p.topics.some(t => t.includes(kw)) ||
      p.tags.some(t => t.includes(kw)));
  }
  const sorters: Record<string, (a: Plugin, b: Plugin) => number> = {
    stars: (a, b) => b.stars - a.stars,
    trend: (a, b) => b.trend_score - a.trend_score,
    updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
    created: (a, b) => b.created_at.localeCompare(a.created_at),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  const sorter = sorters[q.sort || 'stars'];
  if (sorter) list = [...list].sort(sorter);
  if (q.order === 'asc') list.reverse();
  return list;
}

export function paginate<T>(list: T[], page = 1, perPage = 50) {
  perPage = Math.min(Math.max(perPage, 1), 200);
  page = Math.max(page, 1);
  const total = list.length;
  const items = list.slice((page - 1) * perPage, page * perPage);
  return { items, pagination: { page, per_page: perPage, total, total_pages: Math.ceil(total / perPage) } };
}

export function json(body: unknown, init: ResponseInit = {}, etag?: string) {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('X-Api-Version', 'v1');
  if (etag) headers.set('ETag', `"${etag}"`);
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function error(status: number, message: string) {
  return json({ error: { code: status, message } }, { status });
}

export function parseQuery(url: URL): Query {
  const g = (k: string) => url.searchParams.get(k) || undefined;
  return {
    category: g('category'),
    verified: g('verified') === 'true' ? true : g('verified') === 'false' ? false : undefined,
    language: g('language'), license: g('license'), search: g('search') || g('q'),
    sort: g('sort'), order: (g('order') as any) || 'desc',
    page: parseInt(g('page') || '1'), per_page: parseInt(g('per_page') || '50'),
    created_after: g('created_after'), updated_after: g('updated_after'),
  };
}
```

### 6.3 插件列表端点 `functions/api/v1/plugins.ts`

```typescript
import { loadCatalog, filterPlugins, paginate, json, error, parseQuery } from '../../_lib';

export const GET: PagesFunction = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const { data, etag } = await loadCatalog(env);

    // ETag 协商缓存：客户端带 If-None-Match 命中时返回 304（不消耗流量）
    const inm = request.headers.get('If-None-Match');
    if (inm && inm.replace(/"/g, '') === etag) {
      return new Response(null, { status: 304, headers: { ETag: `"${etag}"`, 'Access-Control-Allow-Origin': '*' } });
    }

    const q = parseQuery(url);
    const filtered = filterPlugins(data.plugins, q);
    const { items, pagination } = paginate(filtered, q.page, q.per_page);

    return json({
      meta: { ...data.meta, filtered_count: filtered.length, query: q },
      pagination,
      plugins: items,
    }, { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=3600' } }, etag);
  } catch (e: any) {
    return error(500, e.message);
  }
};

export const OPTIONS = () => new Response(null, {
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
    'Access-Control-Max-Age': '86400',
  },
});
```

### 6.4 其他端点（简表）

| 端点 | 实现要点 |
|---|---|
| `plugins/[slug].ts` | `plugins.find(p => p.slug === slug)`，未找到返回 404 标准错误体 |
| `categories.ts` | 从 `meta.stats.by_category` 生成 `[{id, name, name_zh, count}]` |
| `stats.ts` | 直接返回 `data.meta.stats` + `updated_at` |
| `search.ts` | `q` 参数必填，缺失返回 400；内部复用 `filterPlugins` |
| `meta.ts` | 读取 `/catalog/meta.json`，供监控工作流检查数据新鲜度 |
| `health.ts` | 返回 `{status:"ok", updated_at, count}`，200 即健康 |

### 6.5 MCP 端点 `functions/api/v1/mcp.ts`（AI Agent 专用）

```typescript
// 让 Claude / DSH 等 AI Agent 通过 MCP 协议直接查询插件目录
// 工具：list_plugins(category, search) / get_plugin(slug) / list_categories
export const POST: PagesFunction = async ({ request, env }) => {
  const body = await request.json().catch(() => ({}));
  const { method, params, id } = body as any;
  const { data } = await loadCatalog(env);

  if (method === 'tools/list') {
    return json({ jsonrpc: '2.0', id, result: { tools: [
      { name: 'list_plugins', description: '列出 DSH 插件，可按分类/关键词过滤',
        inputSchema: { type: 'object', properties: {
          category: { type: 'string' }, search: { type: 'string' },
          limit: { type: 'number', default: 20 } } } },
      { name: 'get_plugin', description: '获取单个插件详情',
        inputSchema: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] } },
      { name: 'list_categories', description: '列出所有插件分类及数量' },
    ] } });
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    let result: unknown;
    if (name === 'list_plugins') {
      const list = filterPlugins(data.plugins, { category: args?.category, search: args?.search })
        .slice(0, args?.limit || 20);
      result = list.map(p => ({ name: p.name, slug: p.slug, category: p.category,
        stars: p.stars, description: p.description, install: p.install_cmd }));
    } else if (name === 'get_plugin') {
      result = data.plugins.find((p: any) => p.slug === args?.slug) || null;
    } else if (name === 'list_categories') {
      result = data.meta.stats.by_category;
    } else {
      return json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'unknown tool' } }, { status: 404 });
    }
    return json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
  }

  return json({ jsonrpc: '2.0', id, error: { code: -32600, message: 'unsupported method' } }, { status: 400 });
};
```

### 6.6 错误响应统一格式

```json
{ "error": { "code": 404, "message": "plugin not found: xxx" } }
```

| HTTP 状态 | 场景 |
|---|---|
| 200 | 成功 |
| 304 | ETag 命中（协商缓存） |
| 400 | 参数错误（如 search 缺 q） |
| 404 | 资源不存在 |
| 429 | 触发 Cloudflare WAF 限流规则 |
| 500 | 内部错误（catalog 加载失败等） |

---

## 七、前端站点 V2（Astro 5）

### 7.1 相对 V1 的升级点

| 能力 | V1 | V2 |
|---|---|---|
| Astro 版本 | ^4.0.0 | ^5.0.0（稳定版，静态优先） |
| 首页筛选状态 | 仅内存，刷新丢失 | **同步到 URL 参数**（可分享链接） |
| 排序实现 | 有 bug（updated 排序逻辑错误） | 修复 + 新增按 trend 排序 |
| 新页面 | 无 | `/docs`（API 文档）、`/stats`（统计）、`/404` |
| SEO | 仅基础 meta | sitemap.xml + OG 完整标签 + JSON-LD |
| RSS | 无 | `/feed.xml` |
| 安装命令复制 | 有 XSS 隐患的 onclick 拼接 | 事件委托 + textContent，安全复制 |

### 7.2 `site/astro.config.mjs`

```javascript
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: import.meta.env.PUBLIC_SITE_URL || 'https://dsh-hub.pages.dev',
  output: 'static',
  trailingSlash: 'ignore',
  build: { inlineStylesheets: 'auto', assets: '_astro' },
  compressHTML: true,
});
```

### 7.3 首页 URL 状态同步（`site/src/scripts/app.js` 核心片段）

```javascript
// 搜索/分类/排序全部写入 URL，刷新与分享均保持状态
const state = { q: '', category: 'all', sort: 'stars', filter: 'all' };

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
  history.replaceState(null, '', p.toString() ? `?${p}` : location.pathname);
}

function applyAll() {
  writeStateToURL();
  document.querySelectorAll('.plugin-card').forEach(card => {
    const d = card.dataset;
    let ok = true;
    if (state.category !== 'all') ok = ok && d.category === state.category;
    if (state.filter === 'verified') ok = ok && d.verified === 'true';
    if (state.filter === 'new') ok = ok && d.isNew === 'true';
    if (state.filter === 'trending') ok = ok && +d.trend >= 50;
    if (state.q) {
      const kw = state.q.toLowerCase();
      ok = ok && (d.name + ' ' + d.desc + ' ' + d.tags).includes(kw);
    }
    card.style.display = ok ? '' : 'none';
  });
  updateEmptyTip();
}

readStateFromURL();
applyAll();
// 绑定输入事件 → 修改 state → applyAll()
```

### 7.4 构建时数据注入

首页与详情页仍然在**构建时**从 `catalog/plugins.json` 直接导入（静态生成，零运行时成本）。客户端筛选只是对已渲染卡片的显示/隐藏，400+ 插件规模下性能完全无压力。

### 7.5 `/docs` 页面内容骨架

- 基础 URL 与 CORS 说明
- 全部端点表格（§6.1）+ 每个端点的参数表与 curl 示例
- 响应格式示例（§8.2）
- OpenAPI 下载链接：`/openapi.json`
- MCP 接入示例（Claude Desktop 配置片段）
- 速率限制说明与最佳实践（带 ETag 轮询）

### 7.6 `site/public/_headers`（V2 修正合并重复块）

```headers
# API：CORS 全开 + 短缓存（Functions 会自行设置，此处兜底）
/api/*
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, POST, OPTIONS
  Access-Control-Allow-Headers: Content-Type, If-None-Match
  Access-Control-Max-Age: 86400
  X-Content-Type-Options: nosniff

# OpenAPI 规范与原始数据：允许跨域
/openapi.json
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=3600
/catalog/*
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=300, s-maxage=3600

# 静态资源：一年不可变
/_astro/*
  Cache-Control: public, max-age=31536000, immutable

# 全局安全头
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), camera=(), microphone=()
  Strict-Transport-Security: max-age=63072000; includeSubDomains

# 免费 pages.dev 子域名不索引（绑自定义域名后防重复收录）
https://dsh-hub.pages.dev/*
  X-Robots-Tag: noindex, nofollow
```

### 7.7 `site/public/_redirects`

```redirects
# 向后兼容 V1 的路径
/api/plugins.json        /api/v1/plugins          302
/api/plugins.json/*      /api/v1/plugins:splat     302
/api/v1/plugins/*        /api/v1/plugins/:splat    200
```

---

## 八、OpenAPI 规范与 API 文档

### 8.1 `site/public/openapi.json`（节选）

```json
{
  "openapi": "3.0.3",
  "info": {
    "title": "DSH Plugins Nav API",
    "version": "1.0.0",
    "description": "DeepSeek Harness 插件目录公共 API，CORS 全开，无需认证",
    "license": { "name": "CC-BY-4.0" }
  },
  "servers": [{ "url": "https://dsh-hub.pages.dev" }],
  "paths": {
    "/api/v1/plugins": {
      "get": {
        "summary": "插件列表",
        "parameters": [
          { "name": "category", "in": "query", "schema": { "type": "string" } },
          { "name": "verified", "in": "query", "schema": { "type": "boolean" } },
          { "name": "search", "in": "query", "schema": { "type": "string" } },
          { "name": "sort", "in": "query", "schema": { "type": "string", "enum": ["stars", "trend", "updated", "created", "name"] } },
          { "name": "order", "in": "query", "schema": { "type": "string", "enum": ["asc", "desc"], "default": "desc" } },
          { "name": "page", "in": "query", "schema": { "type": "integer", "default": 1 } },
          { "name": "per_page", "in": "query", "schema": { "type": "integer", "default": 50, "maximum": 200 } },
          { "name": "created_after", "in": "query", "schema": { "type": "string", "format": "date-time" } },
          { "name": "updated_after", "in": "query", "schema": { "type": "string", "format": "date-time" } }
        ],
        "responses": { "200": { "description": "插件列表" }, "304": { "description": "ETag 命中" } }
      }
    },
    "/api/v1/plugins/{slug}": {
      "get": {
        "summary": "插件详情",
        "parameters": [{ "name": "slug", "in": "path", "required": true, "schema": { "type": "string" } }],
        "responses": { "200": { "description": "插件对象" }, "404": { "description": "不存在" } }
      }
    },
    "/api/v1/search": { "get": { "summary": "搜索（q 必填）" } },
    "/api/v1/categories": { "get": { "summary": "分类注册表" } },
    "/api/v1/stats": { "get": { "summary": "聚合统计" } },
    "/api/v1/meta": { "get": { "summary": "同步元信息" } },
    "/api/v1/health": { "get": { "summary": "健康检查" } },
    "/api/v1/mcp": { "post": { "summary": "MCP 端点（JSON-RPC 2.0）" } }
  }
}
```

> 完整文件在落地时按此骨架生成，可直接导入 Postman / Apifox / Swagger UI。

### 8.2 响应示例

**`GET /api/v1/plugins?category=web-ui&verified=true&sort=stars&page=1&per_page=20`**

```json
{
  "meta": {
    "updated_at": "2026-08-23T01:17:00.000Z",
    "count": 426,
    "etag": "a1b2c3d4e5f60718",
    "filtered_count": 42,
    "query": { "category": "web-ui", "verified": true, "sort": "stars" }
  },
  "pagination": { "page": 1, "per_page": 20, "total": 42, "total_pages": 3 },
  "plugins": [ { "slug": "owner-example", "name": "Example", "stars": 128, "install_cmd": "dsh plugin --profile web add github:owner/example", "...": "..." } ]
}
```

### 8.3 第三方调用最佳实践

```javascript
// 带 ETag 的轮询（节省流量，304 不消耗 Functions 流量配额之外的任何东西）
let etag = null, cache = null;
async function getPlugins(params = '') {
  const headers = {};
  if (etag) headers['If-None-Match'] = etag;
  const res = await fetch(`/api/v1/plugins?${params}`, { headers });
  if (res.status === 304) return cache;
  etag = res.headers.get('ETag');
  cache = await res.json();
  return cache;
}
```

```bash
curl -s "https://dsh-hub.pages.dev/api/v1/plugins?search=vision&sort=trend&per_page=10"
curl -s https://dsh-hub.pages.dev/api/v1/stats
curl -s https://dsh-hub.pages.dev/api/v1/health
```

---

## 九、Cloudflare 配置

### 9.1 `wrangler.toml`

```toml
name = "dsh-hub"
pages_build_output_dir = "site/dist"
compatibility_date = "2026-01-01"

# 当前方案不使用任何付费资源（无 KV / D1 / R2）
# KV 升级路径见 §13，届时取消注释：
# [[kv_namespaces]]
# binding = "PLUGIN_DATA"
# id = "<kv-namespace-id>"
```

### 9.2 Secrets（GitHub 仓库配置）

| Secret | 用途 | 获取方式 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Pages 部署 | CF 控制台 → My Profile → API Tokens → Create Token → 模板 "Edit Cloudflare Workers"，或自定义权限 `Account - Cloudflare Pages - Edit` |
| `CLOUDFLARE_ACCOUNT_ID` | 账户标识 | CF 控制台右侧栏 Account ID |

| Variable（仓库 Variables，非机密） | 用途 |
|---|---|
| `SITE_URL` | 监控工作流用，如 `https://dsh-hub.pages.dev` |
| `CF_PAGES_PROJECT` | （GitHub Pages 镜像专用）覆盖主站 API 域名，默认 `https://dsh-hub.pages.dev` |

> `GITHUB_TOKEN` 无需配置，Actions 自动注入。公开仓库上它拥有写权限（需在 Settings → Actions → Workflow permissions 选 "Read and write"）。

### 9.3 Rate Limiting（免费 1 条规则）

Cloudflare 控制台 → Security → WAF → Rate limiting rules：

```
规则名：api-protect
匹配条件：URI Path 以 /api/ 开头
速率：每 10 秒 20 个请求（按 IP）
持续 10 秒计数，超出则：Block 60 秒
```

作用：单个恶意 IP 最多把 Functions 用量刷到约 17 万次/天——仍不足以触发付费墙，但能防住绝大多数脚本刷量。**这条规则是免费的。**

### 9.4 免费额度总账（V2 终版）

| 资源 | 免费额度 | 本项目用量 | 结论 |
|---|---|---|---|
| Pages 静态请求 | **无限** | 全部页面/静态 JSON | 无上限概念 |
| Pages Functions 调用 | 10 万次/天 | 预估 < 5000 次/天 | 1/20，超量只停服不扣费 |
| Pages 构建 | 500 次/月 | 最多 4 次/天 × 30 = 120 | 24% |
| 自定义域名 | 100 个/项目 | 1 个（可选） | — |
| Actions（公开仓库） | **无限分钟** | 预估 < 200 分钟/月 | 无上限概念 |
| WAF Rate Limiting | 1 条免费规则 | 1 条 | 用满 |
| KV / D1 / R2 | 未使用 | 0 | 见 §13 升级路径 |
| 邮件通知 | GitHub 原生免费 | 失败告警 | 0 元 |

> **结论：本方案中不存在任何"超量自动扣费"的环节。** 所有付费能力（Workers Paid、KV 超额、自定义 Workers 路由）都必须人工主动开通，机制上保证 0 元。

---

## 十、无人值守保障（V2 强化）

| 机制 | 实现 |
|---|---|
| 防 60 天静默禁用 | 每日 4 次定时同步本身就是活动，天然保活；心跳空提交机制保留为后备 |
| 同步失败 | Actions 标红 + 邮件告警；旧数据继续服务，站点不受影响 |
| 部署失败 | 同上；下次 push 自动重试 |
| 数据不新鲜 | monitor.yml 检查 `updated_at` 超过 36 小时即告警 |
| 站点宕机 | monitor.yml 每小时探测首页 + API，失败即邮件 |
| API 被刷 | WAF Rate Limiting（§9.3） |
| 依赖漏洞 | dependabot.yml 每周检查 + PR |

### dependabot.yml

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: "/site"
    schedule: { interval: weekly }
  - package-ecosystem: github-actions
    directory: "/"
    schedule: { interval: weekly }
```

---

## 十一、落地检查清单（V2）

> 📋 **首次部署的逐项可勾选验收步骤（含验证命令与预期结果）见 [FIRST_DEPLOY_CHECKLIST.md](./FIRST_DEPLOY_CHECKLIST.md)**，本清单为部署前概要。

### 阶段 1：仓库搭建（30 分钟）
- [ ] 创建公开 GitHub 仓库 `dsh-hub`
- [ ] 按 §2 目录树创建全部文件
- [ ] `npm install`（根目录与 site/ 各一次）
- [ ] 本地 `node scripts/sync.mjs`（全量）验证抓取
- [ ] 本地 `cd site && npm run dev` 验证前端
- [ ] 提交推送

### 阶段 2：Cloudflare 接入（15 分钟）
- [ ] 创建 API Token（§9.2）→ GitHub Secrets
- [ ] GitHub 仓库 Settings → Variables 添加 `SITE_URL`
- [ ] Settings → Actions → Workflow permissions → Read and write
- [ ] 手动触发 deploy.yml，确认部署成功
- [ ] 访问 `https://dsh-hub.pages.dev`（免费域名，立即可用）

### 阶段 3：验证 API（10 分钟）
- [ ] `curl https://<域名>/api/v1/health` → `{"status":"ok"}`
- [ ] `curl "https://<域名>/api/v1/plugins?category=web-ui&per_page=5"` → 有数据
- [ ] 带 `If-None-Match` 请求 → 第二次返回 304
- [ ] 浏览器控制台从**其他域名**的页面 `fetch()` 验证 CORS
- [ ] 用 MCP 客户端连 `https://<域名>/api/v1/mcp` 验证 tools/list

### 阶段 4：自动化验证（24 小时观察）
- [ ] 等待次日 08:18 全量同步自动执行
- [ ] 确认：有变化→自动部署；无变化→无提交
- [ ] monitor.yml 每小时绿色

### 阶段 5：安全加固（10 分钟）
- [ ] 配置 WAF Rate Limiting 规则（§9.3）
- [ ] 启用 Bot Fight Mode
- [ ] 确认 HTTPS 强制（Pages 默认开启）

### 阶段 6：可选增强
- [ ] 绑定自定义域名（§14）
- [ ] 提交 sitemap.xml 到搜索引擎
- [ ] README 添加 Actions 徽章

---

## 十二、API 使用文档（第三方开发者速查）

| 需求 | 调用 |
|---|---|
| 拿全部插件 | `GET /api/v1/plugins?per_page=200`（分页） |
| 某分类的 verified 插件 | `GET /api/v1/plugins?category=web-ui&verified=true` |
| 关键词搜索 | `GET /api/v1/search?q=vision&sort=trend` |
| 最近 7 天新增 | `GET /api/v1/plugins?created_after=<ISO时间>&sort=created` |
| 最近 3 天更新 | `GET /api/v1/plugins?updated_after=<ISO时间>` |
| 单个插件 | `GET /api/v1/plugins/{owner}-{repo}` |
| 分类分布 | `GET /api/v1/categories` |
| 全局统计 | `GET /api/v1/stats` |
| 数据更新时间 | `GET /api/v1/meta` |
| AI Agent 接入 | `POST /api/v1/mcp`（JSON-RPC，见 §6.5） |
| 直接下载原始数据 | `GET /catalog/plugins.json` |
| RSS 订阅 | `GET /feed.xml` |

**无认证、无 API Key、CORS 全开、支持 ETag。唯一限制：WAF 每 IP 每 10 秒 20 次。**

---

## 十三、KV 升级路径（保留方案，当前不启用）

当未来出现以下任一需求时，再启用 KV（仍为免费额度内）：

1. 数据更新要求秒级生效（跳过构建）；
2. 插件数超过 5000，静态 JSON 单文件过大；
3. 需要按用户维度的写入（收藏/安装统计）。

**升级步骤**（预计 30 分钟）：
1. `wrangler kv namespace create PLUGIN_DATA` → 把返回的 id 填入 `wrangler.toml`；
2. sync.yml 增加一步：`wrangler kv bulk put`（把 plugins.json 按 chunk 写入 KV）；
3. `functions/_lib.ts` 的 `loadCatalog` 改为优先读 KV、回退读静态文件（一行切换）；
4. 其余端点代码零改动。

**费用复核**：KV 免费额度为 10 万次读/天、1000 次写/天、1GB 存储。本项目写入仅同步时发生（每天 4 次 × 几个键），读取跟随 API 流量（10 万次/天与 Functions 同量级）。**正常使用仍然 0 元；只有 API 日调用超过 10 万次这一种理论场景会触碰 Workers Paid（$5/月），届时属于业务成功而非风险。**

---

## 十四、自定义域名（可选，随时可做）

1. 域名 NS 迁入 Cloudflare（免费）；
2. Pages 项目 → Custom domains → 添加域名，自动签发 SSL；
3. 更新三处配置：
   - `site/astro.config.mjs` 的 `site`
   - GitHub Variable `SITE_URL`
   - `_headers` 中的 noindex 规则（改为对自定义域名保留索引，对 pages.dev 禁止索引）
4. 等待 DNS 传播（通常 < 1 小时，最长 48 小时）。

---

## 十五、故障排查（V2 新增场景）

| 问题 | 原因 | 解决 |
|---|---|---|
| 同步成功但站点没更新 | deploy.yml 未触发 | 确认同步提交**不带** `[skip ci]`；确认 push 的是 main 分支 |
| API 参数不生效 | 误用了静态 `/api/plugins.json`（V1 路径） | 使用 `/api/v1/plugins`；旧路径已通过 `_redirects` 302 兼容 |
| Functions 500 | catalog 文件未拷入 dist | 检查 deploy.yml 中 `copy-assets.mjs` 步骤；本地 `npm run build` 复现 |
| 304 一直不更新 | 客户端 ETag 缓存逻辑错误 | ETag 随每次同步变化，数据更新后自动失效 |
| 定时任务消失 | 仓库 60 天无活动 | 本项目每天 4 次定时天然保活；如仍被禁，手动 dispatch 一次即恢复 |
| monitor 报数据过旧 | 同步连续失败 | 看 sync.yml 最近运行日志，常见为 GitHub API 临时限速，次日自动恢复 |
| MCP 连接失败 | 客户端只支持 SSE 传输 | 本端点为 HTTP JSON-RPC POST，需客户端支持 streamable-http 或 JSON-RPC over HTTP |

---

## 十六、版本记录

| 版本 | 日期 | 变化 |
|---|---|---|
| V1.0 | 2026-08-21 | 初版：静态站 + 静态 JSON"API" + 每日同步 |
| V2.0 | 2026-08-23 | 全面升级：真·动态 API（Functions）、增量同步、内容级 diff、监控+邮件告警、MCP、OpenAPI、RSS、文档页、修复 [skip ci] 致命问题 |
| V2.1 | 2026-08-23 | 双部署：新增 GitHub Pages 静态镜像（`deploy-pages.yml`）、`PUBLIC_API_URL` 分离 API 域名、`u()` 子路径前缀适配 |

---

> 📌 **总结**：V2 方案 = 全自动（每天 4 次同步 + 手动/外部触发）+ 真·API（10 端点、分页、ETag、MCP）+ 绝对 0 元（静态无限 + Functions 超量只停服不扣费 + 公开仓库 Actions 无限 + GitHub 原生邮件告警）。
> 数据更新链路：同步 → 内容级 diff → 有变化才提交 → 自动部署 → 全球生效，全程无人干预。
> **设一次，跑一年，零成本，且机制上不可能产生账单。**
