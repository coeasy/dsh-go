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
| 1 | [modlens](https://github.com/liustack/modlens) | 3.8k | TypeScript | 2026-09-01 | The first vision plugin for DeepSeek Harne… |
| 2 | [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | 3.2k | TypeScript | 2026-09-01 | 开放的侧边栏底座，支持三方拓展注册新侧边栏页面。内置文件渲染编辑/终端/侧边对话/G… |
| 3 | [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) | 2.8k | TypeScript | 2026-09-01 | DSH 官方公众号收录的 TUI 补位插件：Claude Code 风，鲸鱼顶栏/实… |
| 4 | [dsh-plugin-radar](https://github.com/AdamPlatin123/dsh-plugin-radar) | 1.4k | Python | 2026-09-01 | DSH Plugin Radar — 开源 DSH 插件生态雷达：自动发现 1590… |
| 5 | [dsh-im](https://github.com/xmanrui/dsh-im) | 1k | JavaScript | 2026-09-01 | 通过扫码或机器人凭据把IM机器人接入DeepSeek Harness（支持飞书、微信… |
| 6 | [dsh_desktop](https://github.com/myYangyunfan/dsh_desktop) | 617 | JavaScript | 2026-09-01 | DeepSeek Harness (dsh) Windows desktop cli… |
| 7 | [deepseek-harness-desktop](https://github.com/dsh-tauri-desk/deepseek-harness-desktop) | 1.5k | Rust | 2026-09-01 | DeepSeek Harness Tauri 桌面版 \| Only 5mb ins… |
| 8 | [dsh-context](https://github.com/bowenliang123/dsh-context) | 1.2k | TypeScript | 2026-09-01 | The best DeepSeek Harness plugin for conte… |
| 9 | [dsh-vision-router](https://github.com/ysr666/dsh-vision-router) | 1k | JavaScript | 2026-09-01 | Eyes for text-only DeepSeek Harness agents… |
| 10 | [dsh-market](https://github.com/dsh-market/dsh-market) | 3k | TypeScript | 2026-09-01 | The plugin market inside DeepSeek Harness … |
| 11 | [dsh-genui](https://github.com/omdsh-dev/dsh-genui) | 384 | TypeScript | 2026-09-01 | GenUI for DeepSeek Harness: interactive UI… |
| 12 | [dsh-handbook](https://github.com/Electricitysheep/dsh-handbook) | 724 | HTML | 2026-09-01 | DeepSeek Harness (dsh) 从 0 到 1 深度手册：安装/插件开… |
| 13 | [deepseek-harness-studio](https://github.com/fufankeji/deepseek-harness-studio) | 585 | TypeScript | 2026-09-01 | DeepSeek Harness 零代码桌面端｜一键启动，支持 Windows 与 … |
| 14 | [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) | 496 | TypeScript | 2026-09-01 | DSH 桌面宠物：一行命令装好即用的透明动画小桌宠，支持多开、大小位置随心配置；还内… |
| 15 | [dsh-browser](https://github.com/Lum1104/dsh-browser) | 543 | TypeScript | 2026-09-01 | Chrome sidebar extension that lets DeepSee… |
| 16 | [dsh-plugin-subscriptions](https://github.com/V1ki/dsh-plugin-subscriptions) | 307 | TypeScript | 2026-09-01 | Use ChatGPT (Codex), Claude, and Grok (X P… |
| 17 | [dsh-at-file](https://github.com/FSMargoo/dsh-at-file) | 500 | JavaScript | 2026-09-01 | Codex-style @file mentions for DeepSeek Ha… |
| 18 | [dsh-mnemon](https://github.com/omdsh-dev/dsh-mnemon) | 303 | TypeScript | 2026-08-31 | Composable three-tier memory control plane… |
| 19 | [dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit) | 847 | TypeScript | 2026-08-31 | [dsh]为纯文本模型设计更强大的视觉工具箱：一行安装使用、粘贴图片直接识别、多张图… |
| 20 | [dsh-infinite-gen-3](https://github.com/Minglink/dsh-infinite-gen-3) | 728 | JavaScript | 2026-08-31 | DeepSeek 专用破甲插件「无限三代」dsh-infinite-gen-3 — … |

更新时间：2026-09-01
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
| `GET /api/v1` | API 服务索引与安装语义 |
| `GET /api/v1/capabilities` | 当前 Catalog/Registry/部署能力与一致性信息 |
| `GET /api/v1/registry/delta` | Registry Distribution V1 增量变更 |
| `GET /api/v1/registry/packages/:type/:id/versions` | 包版本、commit、artifact 与安全证据 |
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

> API 使用示例、参数与 MCP 接入见站内 `/docs`。机器客户端可先读取 `/.well-known/dsh-marketplace.json` 或 `/api/v1/capabilities`；三平台静态站点都提供同一发现契约。

## 如何收录你的插件

给你的 GitHub 仓库添加 `dsh-plugin` topic，下一次每日同步（或手动触发）后自动收录。

## 提交新插件（人工）

Fork 后编辑 `catalog/overrides.json`（可选字段覆盖）并发 PR；或直接开 Issue，说明仓库地址。

## 许可证

MIT（数据来源 GitHub 公开仓库）。
