# DSH Go

DeepSeek Harness 插件市场导航站 —— 全自动同步、真·RESTful API、绝对 0 元部署。
API调用使用域名：https://dsh-go.pages.dev/

## 特性

- **全自动更新**：每日 08:18 全量同步 + 每 6 小时增量同步（多主题并集抓取：`dsh-plugin` + DeepSeek Harness 生态，自动过滤非插件）
- **趋势 / 热门榜**：`/trending` 页按热度评分（Star + 增速 + 更新频率）排名
- **详情页简介 + 一键分享**：展示插件简介摘要、可安装命令，并支持一键复制 Markdown 徽章便于分享
- **多维索引**：首页支持分类 + 语言 + 状态 + 排序叠加筛选，全部同步到 URL 可分享
- **真·动态 API**：`/api/v1/*` 过滤/搜索/排序/分页/ETag 304
- **MCP 端点**：`/api/v1/mcp`，AI Agent 直接查询插件目录
- **零成本**：静态无限量 + 云函数免费额度 + 公开仓库 Actions 无限
- **自助监控**：每小时健康检查 + GitHub 原生邮件告警

<!-- HOT-PLUGINS:START -->
## 🔥 最近热门推荐（300-5000★）

> 自动生成 · 仅收录**命名含 dsh / deepseek-harness 的 DSH 原生插件**（排除 awesome 盘点型仓库），并固定推荐 modlens / dsh-better-sidebar · 按最近更新排序 · Top20（每次同步后刷新）

| # | 插件 | ★ Stars | 语言 | 最近更新 | 简介 |
|---|------|---------|------|----------|------|
| 1 | [@liustack/modlens](https://github.com/liustack/modlens) | 3.6k | TypeScript | 2026-08-24 | Plug-in vision for text-only LLMs, powered… |
| 2 | [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | 2.9k | TypeScript | 2026-08-25 | DSH web plugin: a VSCode-like right sideba… |
| 3 | [dsh-vision-router](https://github.com/ysr666/dsh-vision-router) | 969 | JavaScript | 2026-08-25 | Eyes for text-only DeepSeek Harness agents… |
| 4 | [treg-dsh](https://github.com/superdesigndev/treg) | 599 | Python | 2026-08-25 | OpenRouter for tools - 2,600 agent-friendl… |
| 5 | [deepseek-harness-desktop](https://github.com/dsh-tauri-desk/deepseek-harness-desktop) | 1.1k | Rust | 2026-08-25 | Desktop application for DeepSeek Harness (… |
| 6 | [@deepseek-harness-tui/dsh-tui](https://github.com/ccch1mneyyy/dsh-TUI) | 2.5k | TypeScript | 2026-08-25 | Claude Code style interactive TUI front do… |
| 7 | [dshmarket](https://github.com/dsh-market/dsh-market) | 2.3k | TypeScript | 2026-08-25 | Visual plugin market inside DeepSeek Harne… |
| 8 | [dsh-context](https://github.com/bowenliang123/dsh-context) | 1k | TypeScript | 2026-08-25 | A DeepSeek Harness plugin for context insi… |
| 9 | [@xmanrui/dsh-im](https://github.com/xmanrui/dsh-im) | 820 | JavaScript | 2026-08-25 | 把九种 IM 机器人和公网 AI Office 接入本机 DeepSeek Harn… |
| 10 | [dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale) | 1.7k | TypeScript | 2026-08-25 | Whale Girl skin series for DeepSeek Harnes… |
| 11 | [@anionex/dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit) | 822 | TypeScript | 2026-08-25 | DeepSeek Harness-native integration for ag… |
| 12 | [dsh-desktop](https://github.com/vibeinging/dsh-desktop) | 631 | JavaScript | 2026-08-25 | DeepSeek Harness Desktop App: a local AI d… |
| 13 | [@deepseek-ai/dsh-root](https://github.com/fufankeji/deepseek-harness-studio) | 515 | TypeScript | 2026-08-25 | DeepSeek Harness 零代码桌面端｜一键启动，支持 Windows 与 … |
| 14 | [dsh-router-standard](https://github.com/yjh051108/dsh-router-standard) | 373 | JavaScript | 2026-08-24 | Progressive tool disclosure router suite f… |
| 15 | [dsh-whale-widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) | 932 | JavaScript | 2026-08-24 | DSH Web 界面右下角的 DeepSeek 余额小鲸鱼挂件（含今日已用、峰谷定价… |
| 16 | [@changfenhuang/dsh-genui](https://github.com/omdsh-dev/dsh-genui) | 331 | TypeScript | 2026-08-24 | GenUI for DeepSeek Harness: interactive UI… |
| 17 | [dsh-api-relay-audit](https://github.com/toby-bridges/api-relay-audit) | 806 | Python | 2026-08-24 | DeepSeek Harness bundle for running API Re… |
| 18 | [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) | 405 | TypeScript | 2026-08-24 | DSH 桌面宠物：一行命令装好即用的透明动画小桌宠，支持多开、大小位置随心配置；还内… |
| 19 | [dsh-browser](https://github.com/Lum1104/dsh-browser) | 440 | TypeScript | 2026-08-24 | Standalone dsh browser bridge and controll… |
| 20 | [dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard) | 3.7k | JavaScript | 2026-08-23 | Two-phase DeepSeek Harness preset: Minimal… |

更新时间：2026-08-25
<!-- HOT-PLUGINS:END -->

## 快速开始

### 1. 本地开发

```bash
npm ci                    # 根依赖（wrangler / sync 脚本）
npm run sync              # 首次全量同步（可选，便于本地预览）
cd site && npm ci         # 前端依赖
npm run site:dev          # 启动本地开发服务器
```

### 2. 开放 API 速查

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
