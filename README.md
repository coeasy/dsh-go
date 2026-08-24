# DSH Go

DeepSeek Harness 插件市场导航站 —— 全自动同步、真·RESTful API、绝对 0 元部署。

[![Deploy](https://github.com/coeasy/dsh_go/actions/workflows/deploy.yml/badge.svg)](https://github.com/coeasy/dsh_go/actions/workflows/deploy.yml)
[![Sync](https://github.com/coeasy/dsh_go/actions/workflows/sync.yml/badge.svg)](https://github.com/coeasy/dsh_go/actions/workflows/sync.yml)
[![Monitor](https://github.com/coeasy/dsh_go/actions/workflows/monitor.yml/badge.svg)](https://github.com/coeasy/dsh_go/actions/workflows/monitor.yml)
[![Pages](https://github.com/coeasy/dsh_go/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/coeasy/dsh_go/actions/workflows/deploy-pages.yml)

## 特性

- **全自动更新**：每日 08:18 全量同步 + 每 6 小时增量同步（多主题并集抓取：`dsh-plugin` + DeepSeek Harness 生态，自动过滤非插件）
- **趋势 / 热门榜**：`/trending` 页按热度评分（Star + 增速 + 更新频率）排名
- **详情页完整 README**：从 GitHub 拉取并轻量渲染完整 README，一键复制 Markdown 徽章便于分享
- **多维索引**：首页支持分类 + 语言 + 状态 + 排序叠加筛选，全部同步到 URL 可分享
- **真·动态 API**：`/api/v1/*`（Cloudflare Pages Functions），过滤/搜索/排序/分页/ETag 304
- **MCP 端点**：`/api/v1/mcp`，AI Agent 直接查询插件目录
- **多位置部署**：Cloudflare Pages（全功能，含 API）+ GitHub Pages（静态镜像）+ Gitee / GitCode（国内静态镜像，多个位置可同时运行）
- **零成本**：静态无限量 + Functions 免费 10 万次/天（超量只停服不扣费）+ 公开仓库 Actions 无限
- **自助监控**：每小时健康检查 + GitHub 原生邮件告警

<!-- HOT-PLUGINS:START -->
## 🔥 最近热门推荐（300-5000★）

> 自动生成 · 仅收录**命名含 dsh / deepseek-harness 的 DSH 原生插件**，并固定推荐 modlens · 按最近更新排序 · Top20（每次同步后刷新）

| # | 插件 | ★ Stars | 语言 | 最近更新 | 简介 |
|---|------|---------|------|----------|------|
| 1 | [@liustack/modlens](https://github.com/liustack/modlens) | 3.6k | TypeScript | 2026-08-24 | Plug-in vision for text-only LLMs, powered… |
| 2 | [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | 2.8k | TypeScript | 2026-08-24 | DSH web plugin: a VSCode-like right sideba… |
| 3 | [awesome-dsh-plugins](https://github.com/AdamPlatin123/awesome-dsh-plugins) | 1.4k | Python | 2026-08-24 | DSH 插件雷达与精选榜：多路自动发现 9000+ 候选，容器真实安装路径运行级实测… |
| 4 | [@deepseek-harness-tui/dsh-tui](https://github.com/ccch1mneyyy/dsh-TUI) | 2.4k | TypeScript | 2026-08-24 | Claude Code style interactive TUI front do… |
| 5 | [dsh-context](https://github.com/bowenliang123/dsh-context) | 990 | TypeScript | 2026-08-24 | A DeepSeek Harness plugin for context insi… |
| 6 | [deepseek-harness-desktop](https://github.com/dsh-tauri-desk/deepseek-harness-desktop) | 1.1k | Rust | 2026-08-24 | Desktop application for DeepSeek Harness (… |
| 7 | [dsh-vision-router](https://github.com/ysr666/dsh-vision-router) | 958 | JavaScript | 2026-08-24 | Eyes for text-only DeepSeek Harness agents… |
| 8 | [@anionex/dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit) | 818 | TypeScript | 2026-08-24 | DeepSeek Harness-native integration for ag… |
| 9 | [dshmarket](https://github.com/dsh-market/dsh-market) | 2.2k | TypeScript | 2026-08-24 | Visual plugin market inside DeepSeek Harne… |
| 10 | [@changfenhuang/dsh-genui](https://github.com/omdsh-dev/dsh-genui) | 323 | TypeScript | 2026-08-24 | GenUI for DeepSeek Harness: interactive UI… |
| 11 | [awesome-deepseek-harness](https://github.com/0xsline/awesome-deepseek-harness) | 876 | Python | 2026-08-24 | DeepSeek Harness (DSH) ecosystem: curated … |
| 12 | [dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale) | 1.7k | TypeScript | 2026-08-24 | Whale Girl skin series for DeepSeek Harnes… |
| 13 | [@xmanrui/dsh-im](https://github.com/xmanrui/dsh-im) | 753 | JavaScript | 2026-08-24 | 把九种 IM 机器人和公网 AI Office 接入本机 DeepSeek Harn… |
| 14 | [treg-dsh](https://github.com/superdesigndev/treg) | 577 | Python | 2026-08-24 | OpenRouter for tools - 2,600 agent-friendl… |
| 15 | [@deepseek-ai/dsh-root](https://github.com/fufankeji/deepseek-harness-studio) | 495 | TypeScript | 2026-08-24 | DeepSeek Harness 零代码桌面端｜一键启动，支持 Windows 与 … |
| 16 | [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) | 388 | TypeScript | 2026-08-24 | DSH 桌面宠物：一行命令装好即用的透明动画小桌宠，支持多开、大小位置随心配置；还内… |
| 17 | [dsh-browser](https://github.com/Lum1104/dsh-browser) | 421 | TypeScript | 2026-08-24 | Standalone dsh browser bridge and controll… |
| 18 | [dsh-whale-widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) | 829 | JavaScript | 2026-08-24 | DSH Web 界面右下角的 DeepSeek 余额小鲸鱼挂件（含今日已用、峰谷定价… |
| 19 | [dsh-desktop](https://github.com/vibeinging/dsh-desktop) | 629 | JavaScript | 2026-08-24 | DeepSeek Harness Desktop App: a local AI d… |
| 20 | [dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard) | 3.7k | JavaScript | 2026-08-24 | Two-phase DeepSeek Harness preset: Minimal… |

更新时间：2026-08-24
<!-- HOT-PLUGINS:END -->

## 快速开始

### 1. 部署到 Cloudflare Pages

> 采用 **Direct Upload**：构建在 GitHub Actions 完成，通过 `deploy.yml` 上传 `site/dist`。**不要在 CF 控制台连接 Git 仓库或配置构建命令**，否则会与 Action 双重触发构建。

1. 仓库设为公开；
2. CF 控制台 → Workers & Pages → Create → Pages → **Upload assets**，项目名 `dsh-go`；
3. 在 GitHub Actions Secrets 添加 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`，Variables 添加 `SITE_URL = https://dsh-go.pages.dev`；
4. 手动触发一次 `Deploy` 工作流，访问 `https://dsh-go.pages.dev`。

### 2. 可选：GitHub Pages 静态镜像 / 国内镜像（Gitee、GitCode）

- **GitHub Pages**：仓库 Settings → Pages → Source 选 **GitHub Actions**，并确保 Actions → Workflow permissions 为 **Read and write**；推送 `main` 即部署到 `https://coeasy.github.io/dsh_go/`（镜像站 `/api/v1/*` 不可用，前端静态渲染不受影响）。
- **国内镜像**（Gitee / GitCode）：在 Variables 配置 `GITEE_TOKEN` / `GITCODE_TOKEN` 与 `GITCODE_REPO = <命名空间>/dsh_go`，`deploy-mirror.yml` 会把纯静态产物推送到对应 `gh-pages` 分支，加速国内访问。

> 各地始终同步更新；具体配置细节与内部部署方案见仓库内部署文档。

### 3. 本地开发

```bash
npm ci                    # 根依赖（wrangler / sync 脚本）
npm run sync              # 首次全量同步（可选，便于本地预览）
cd site && npm ci         # 前端依赖
npm run site:dev          # 启动本地开发服务器
```

### 4. 开放 API 速查

| 端点 | 说明 |
|---|---|
| `GET /api/v1/plugins` | 插件列表（`?category=&verified=&search=&sort=&page=&per_page=`） |
| `GET /api/v1/plugins/:slug` | 插件详情 |
| `GET /api/v1/search?q=` | 关键词搜索 |
| `GET /api/v1/categories` | 分类 + 计数 |
| `GET /api/v1/stats` | 统计 + Top 榜单 |
| `GET /api/v1/meta` | 数据更新时间 |
| `GET /api/v1/health` | 健康检查 |
| `POST /api/v1/mcp` | MCP（AI Agent） |
| `GET /catalog/plugins.json` | 原始全量数据 |
| `GET /feed.xml` | RSS |

> API 使用示例、参数与 MCP 接入见站内 `/docs`。

## 如何收录你的插件

给你的 GitHub 仓库添加 `dsh-plugin` topic，下一次每日同步（或手动触发）后自动收录。

## 提交新插件（人工）

Fork 后编辑 `catalog/overrides.json`（可选字段覆盖）并发 PR；或直接开 Issue，说明仓库地址。

## 许可证

MIT（数据来源 GitHub 公开仓库）。
