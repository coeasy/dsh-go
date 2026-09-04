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
| 2 | [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | 3.3k | TypeScript | 2026-09-03 | 开放的侧边栏底座，支持三方拓展注册新侧边栏页面。内置文件渲染编辑/终端/侧边对话/G… |
| 3 | [dsh-plugin-radar](https://github.com/AdamPlatin123/dsh-plugin-radar) | 1.4k | Python | 2026-09-04 | DSH Plugin Radar — 开源 DSH 插件生态雷达：自动发现 1590… |
| 4 | [dsh-mnemon](https://github.com/omdsh-dev/dsh-mnemon) | 323 | TypeScript | 2026-09-04 | Composable three-tier memory control plane… |
| 5 | [dsh-desktop](https://github.com/vibeinging/dsh-desktop) | 636 | JavaScript | 2026-09-04 | DeepSeek Harness Desktop App: a local AI d… |
| 6 | [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) | 2.8k | TypeScript | 2026-09-04 | DSH 官方公众号收录的 TUI 补位插件：Claude Code 风，鲸鱼顶栏/实… |
| 7 | [dsh-image-gen](https://github.com/shanliuling/dsh-image-gen) | 305 | TypeScript | 2026-09-04 | Generate images directly in DeepSeek Harne… |
| 8 | [deepseek-harness-desktop](https://github.com/dsh-tauri-desk/deepseek-harness-desktop) | 1.6k | TypeScript | 2026-09-04 | DeepSeek Harness Tauri 桌面版 \| Only 5mb ins… |
| 9 | [dsh-im](https://github.com/xmanrui/dsh-im) | 1.1k | JavaScript | 2026-09-03 | 通过扫码或机器人凭据把IM机器人接入DeepSeek Harness（支持飞书、微信… |
| 10 | [dsh-infinite-gen-3](https://github.com/Minglink/dsh-infinite-gen-3) | 925 | C# | 2026-09-03 | DeepSeek 专用破甲插件「无限三代」dsh-infinite-gen-3 — … |
| 11 | [dsh-vision-router](https://github.com/ysr666/dsh-vision-router) | 1.1k | JavaScript | 2026-09-03 | Eyes for text-only DeepSeek Harness agents… |
| 12 | [dsh-context](https://github.com/bowenliang123/dsh-context) | 1.3k | TypeScript | 2026-09-03 | The best DeepSeek Harness plugin for conte… |
| 13 | [dsh-worktable](https://github.com/Aisland-SJL/dsh-worktable) | 469 | JavaScript | 2026-09-03 | 🖥️ Agent-project workbench for DeepSeek H… |
| 14 | [oh-dsh](https://github.com/hust-open-atom-club/oh-dsh) | 302 | TypeScript | 2026-09-03 | 一套 DSH runtime，Desktop、Web 与 TUI 三种开发体验。 |
| 15 | [dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale) | 1.9k | TypeScript | 2026-09-03 | Whale Girl skin series for DeepSeek Harnes… |
| 16 | [dsh-market](https://github.com/dsh-market/dsh-market) | 3.1k | TypeScript | 2026-09-03 | The plugin market inside DeepSeek Harness … |
| 17 | [dsh-purge](https://github.com/YuJunZhiXue/dsh-purge) | 312 | JavaScript | 2026-09-03 | DeepSeek Harness 破甲：让所有模型都能破甲，不同模型可换不同提示词；… |
| 18 | [dsh-browser](https://github.com/Lum1104/dsh-browser) | 564 | TypeScript | 2026-09-03 | Chrome sidebar extension that lets DeepSee… |
| 19 | [dsh_desktop](https://github.com/myYangyunfan/dsh_desktop) | 627 | JavaScript | 2026-09-03 | DeepSeek Harness (dsh) Windows desktop cli… |
| 20 | [dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit) | 849 | TypeScript | 2026-09-03 | [dsh]为纯文本模型设计更强大的视觉工具箱：一行安装使用、粘贴图片直接识别、多张图… |

更新时间：2026-09-04
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

### 直接安装 DSH Marketplace MCP 插件

本项目同时提供独立的 DSH MCP 包，可由 DSH Runtime 安装并使用：

```bash
dsh mcp install dsh-go-marketplace@0.1.2
dsh startup activate
dsh mcp start dsh-go-marketplace
dsh mcp invoke dsh-go-marketplace search_plugins --input '{"q":"mcp","limit":10}'
```

安装前会执行 Registry、兼容性和权限预检；该包仅声明对 `dsh-go.pages.dev` 的网络访问，不会远程执行安装、shell 或重启客户端。

## 如何收录你的插件

给你的 GitHub 仓库添加 `dsh-plugin` topic，下一次每日同步（或手动触发）后自动收录。

## 提交新插件（人工）

Fork 后编辑 `catalog/overrides.json`（可选字段覆盖）并发 PR；或直接开 Issue，说明仓库地址。

## 许可证

MIT（数据来源 GitHub 公开仓库）。
