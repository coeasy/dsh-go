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
## 🔥 最近热门推荐（500-3000★）

> 自动生成 · 仅收录**命名含 dsh / deepseek-harness 的 DSH 原生插件** · 按最近更新排序 · Top20（每次同步后刷新）

| # | 插件 | ★ Stars | 语言 | 最近更新 | 简介 |
|---|------|---------|------|----------|------|
| 1 | [dsh-vision-router](https://github.com/ysr666/dsh-vision-router) | 952 | JavaScript | 2026-08-24 | Eyes for text-only DeepSeek Harness agents… |
| 2 | [@deepseek-harness-tui/dsh-tui](https://github.com/ccch1mneyyy/dsh-TUI) | 2.4k | TypeScript | 2026-08-24 | Claude Code style interactive TUI front do… |
| 3 | [deepseek-harness-desktop](https://github.com/dsh-tauri-desk/deepseek-harness-desktop) | 1.1k | Rust | 2026-08-24 | Desktop application for DeepSeek Harness (… |
| 4 | [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | 2.8k | TypeScript | 2026-08-24 | DSH web plugin: a VSCode-like right sideba… |
| 5 | [treg-dsh](https://github.com/superdesigndev/treg) | 574 | Python | 2026-08-24 | OpenRouter for tools - 2,600 agent-friendl… |
| 6 | [awesome-deepseek-harness](https://github.com/0xsline/awesome-deepseek-harness) | 869 | Python | 2026-08-24 | DeepSeek Harness (DSH) ecosystem: curated … |
| 7 | [dsh-whale-widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) | 774 | JavaScript | 2026-08-24 | DSH Web 界面右下角的 DeepSeek 余额小鲸鱼挂件（含今日已用、峰谷定价… |
| 8 | [dsh-desktop](https://github.com/vibeinging/dsh-desktop) | 625 | JavaScript | 2026-08-24 | DeepSeek Harness Desktop App: a local AI d… |
| 9 | [dshmarket](https://github.com/dsh-market/dsh-market) | 2.1k | TypeScript | 2026-08-24 | Visual plugin market inside DeepSeek Harne… |
| 10 | [@xmanrui/dsh-im](https://github.com/xmanrui/dsh-im) | 726 | JavaScript | 2026-08-24 | 把九种 IM 机器人和公网 AI Office 接入本机 DeepSeek Harn… |
| 11 | [@anionex/dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit) | 819 | TypeScript | 2026-08-24 | DeepSeek Harness-native integration for ag… |
| 12 | [awesome-dsh-plugins](https://github.com/AdamPlatin123/awesome-dsh-plugins) | 1.4k | Python | 2026-08-24 | DSH 插件雷达与精选榜：多路自动发现 9000+ 候选，容器真实安装路径运行级实测… |
| 13 | [dsh-context](https://github.com/bowenliang123/dsh-context) | 975 | TypeScript | 2026-08-24 | A DeepSeek Harness plugin for context insi… |
| 14 | [dsh-pocket](https://github.com/shaobeichen/dsh-pocket) | 538 | JavaScript | 2026-08-23 | 把 DeepSeek Harness 装进你的口袋：一个包、一个设置页，手机扫码即同… |
| 15 | [@mnemon-dev/dsh-mnemon](https://github.com/mnemon-dev/mnemon) | 513 | Go | 2026-08-23 | Install the full dsh-mnemon integration fr… |
| 16 | [dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale) | 1.6k | TypeScript | 2026-08-23 | Whale Girl skin series for DeepSeek Harnes… |
| 17 | [@dsh-external/dsh-ads](https://github.com/Nagi-ovo/dsh-ads) | 553 | TypeScript | 2026-08-23 | DSH ad-infestation plugin: localized Chine… |
| 18 | [@nanmicoder/dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) | 904 | TypeScript | 2026-08-23 | AgentTeams for DeepSeek Harness: multi-age… |
| 19 | [dsh-handbook](https://github.com/Electricitysheep/dsh-handbook) | 642 | HTML | 2026-08-22 | DeepSeek Harness (dsh) 从 0 到 1 深度手册：安装/插件开… |
| 20 | [awesome-dsh-plugin](https://github.com/Anil-matcha/awesome-dsh-plugin) | 979 | — | 2026-08-20 | A curated list of plugins for DeepSeek Har… |

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
