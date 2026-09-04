# DSH Go

DSH Go 是面向 DeepSeek Harness 生态的 **原生包管理器 + Registry/Distribution 基础设施 + Marketplace**。它统一管理 Plugin、MCP、Skill、Agent 的发现、版本解析、安装计划、安全预检和本地生命周期，同时提供只读 API、MCP 接口与多语言 Web Marketplace。

API 权威入口：https://dsh-go.pages.dev/

> 核心边界：Marketplace 负责发现；Registry V3 负责远程包身份、版本、commit 与安全元数据；Local Runtime 才是本地安装、更新、回滚、写 Runtime Registry 和激活的执行权威。远程页面/API 不自动修改本地 Runtime，也不自动重启客户端。

## 架构

```text
DSH Ecosystem Platform
├── DSH Package Manager / Local Runtime
│   ├── CLI / Host Bridge / Deep Link
│   ├── Resolver / Dependency Solver / Preflight
│   ├── Transaction / Artifact Installer / Rollback
│   └── Runtime Registry V3 / Startup Activation
├── DSH Registry Platform / Remote Data Plane
│   ├── Catalog Sync / Registry V3 / Distribution V1
│   ├── Search Index / Advisories / Publisher Evidence
│   └── API V1 / MCP
└── DSH Marketplace / Discovery Plane
    ├── Astro Web / Search / Trending / Trust / Publisher
    ├── Profiles / Bundles
    └── en / zh-CN / ja / ko / es
```

详细的当前实现、核心链路、技术债务和分阶段优化计划见 [`docs/architecture/dsh-go-current-architecture-and-optimization-v1.md`](docs/architecture/dsh-go-current-architecture-and-optimization-v1.md)。

## 核心能力

- **统一 Package Model**：Plugin / MCP / Skill / Agent 使用 `(type,id)` 身份、统一生命周期和 Runtime Registry V3。
- **本地 Package Manager**：支持解析、依赖图、兼容性/权限预检、事务安装、更新、回滚、修复、启停和显式 Startup Activation。
- **Registry V3 安装权威**：type、version、immutable commit、artifact、permissions、security evidence 以 Registry 为准。
- **Distribution V1 / Delta**：面向大规模 Registry 的分片与增量消费，保留兼容 Catalog 出口。
- **Marketplace**：类型发现、搜索、趋势、Publisher、Trust、Profiles/Bundles 与本地安装入口。
- **多语言**：站点支持 English、简体中文、日本語、한국어、Español，并覆盖动态筛选/搜索结果。
- **只读 API / MCP**：`/api/v1/*` 与 `/api/v1/mcp` 提供发现、查询和安装计划，不远程执行本地安装。
- **自动同步**：每日 08:18 全量同步 + 每 6 小时增量同步，多来源归一到 Registry V3。
- **三平台发布**：Cloudflare Pages 作为 API 权威面，GitHub Pages / EdgeOne Pages 作为静态副本，并校验 commit/Registry/provider 收敛。
- **安全边界**：危险权限显式确认、revoked/critical fail-closed、immutable source 验证、evidence digest 校验；安装成功后仅设置 `restart_required`，绝不自动重启客户端。

<!-- HOT-PLUGINS:START -->
## 🔥 最近热门推荐（300-5000★）

> 自动生成 · 仅收录**命名含 dsh / deepseek-harness 的 DSH 原生插件**（排除 awesome 盘点型仓库），并固定推荐 modlens / dsh-better-sidebar · 按最近更新排序 · Top20（每次同步后刷新）

| # | 插件 | ★ Stars | 语言 | 最近更新 | 简介 |
|---|------|---------|------|----------|------|
| 1 | [modlens](https://github.com/liustack/modlens) | 3.9k | TypeScript | 2026-09-01 | The first vision plugin for DeepSeek Harne… |
| 2 | [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | 3.3k | TypeScript | 2026-09-03 | 开放的侧边栏底座，支持三方拓展注册新侧边栏页面。内置文件渲染编辑/终端/侧边对话/G… |
| 3 | [dsh-plugin-radar](https://github.com/AdamPlatin123/dsh-plugin-radar) | 1.4k | Python | 2026-09-04 | DSH Plugin Radar — 开源 DSH 插件生态雷达：自动发现 1590… |
| 4 | [dsh-browser](https://github.com/Lum1104/dsh-browser) | 566 | TypeScript | 2026-09-04 | Chrome sidebar extension that lets DeepSee… |
| 5 | [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) | 2.8k | TypeScript | 2026-09-04 | DSH 官方公众号收录的 TUI 补位插件：Claude Code 风，鲸鱼顶栏/实… |
| 6 | [oh-dsh](https://github.com/hust-open-atom-club/oh-dsh) | 302 | TypeScript | 2026-09-04 | 一套 DSH runtime，Desktop、Web 与 TUI 三种开发体验。 |
| 7 | [dshcode](https://github.com/whitelonng/dshcode) | 711 | TypeScript | 2026-09-04 | Community desktop companion for DeepSeek H… |
| 8 | [dsh-plugin-subscriptions](https://github.com/V1ki/dsh-plugin-subscriptions) | 318 | TypeScript | 2026-09-04 | Use ChatGPT (Codex), Claude, and Grok (X P… |
| 9 | [dsh-mnemon](https://github.com/omdsh-dev/dsh-mnemon) | 323 | TypeScript | 2026-09-04 | Composable three-tier memory control plane… |
| 10 | [dsh-desktop](https://github.com/vibeinging/dsh-desktop) | 636 | JavaScript | 2026-09-04 | DeepSeek Harness Desktop App: a local AI d… |
| 11 | [dsh-image-gen](https://github.com/shanliuling/dsh-image-gen) | 305 | TypeScript | 2026-09-04 | Generate images directly in DeepSeek Harne… |
| 12 | [deepseek-harness-desktop](https://github.com/dsh-tauri-desk/deepseek-harness-desktop) | 1.6k | TypeScript | 2026-09-04 | DeepSeek Harness Tauri 桌面版 \| Only 5mb ins… |
| 13 | [dsh-im](https://github.com/xmanrui/dsh-im) | 1.1k | JavaScript | 2026-09-04 | 通过扫码或机器人凭据把IM机器人接入DeepSeek Harness（支持飞书、微信… |
| 14 | [dsh-infinite-gen-3](https://github.com/Minglink123/dsh-infinite-gen-3) | 927 | C# | 2026-09-03 | DeepSeek 专用破甲插件「无限三代」dsh-infinite-gen-3 — … |
| 15 | [dsh-vision-router](https://github.com/ysr666/dsh-vision-router) | 1.1k | JavaScript | 2026-09-03 | Eyes for text-only DeepSeek Harness agents… |
| 16 | [dsh-context](https://github.com/bowenliang123/dsh-context) | 1.3k | TypeScript | 2026-09-03 | The best DeepSeek Harness plugin for conte… |
| 17 | [dsh-worktable](https://github.com/Aisland-SJL/dsh-worktable) | 469 | JavaScript | 2026-09-03 | 🖥️ Agent-project workbench for DeepSeek H… |
| 18 | [dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale) | 1.9k | TypeScript | 2026-09-03 | Whale Girl skin series for DeepSeek Harnes… |
| 19 | [dsh-market](https://github.com/dsh-market/dsh-market) | 3.1k | TypeScript | 2026-09-03 | The plugin market inside DeepSeek Harness … |
| 20 | [dsh-purge](https://github.com/YuJunZhiXue/dsh-purge) | 317 | JavaScript | 2026-09-03 | DeepSeek Harness 破甲：让所有模型都能破甲，不同模型可换不同提示词；… |

更新时间：2026-09-04
<!-- HOT-PLUGINS:END -->

## 快速开始

### 1. 本地开发

```bash
npm ci                    # 根依赖（Runtime / Functions / sync / tests）
npm run sync              # 首次全量同步（可选，便于本地预览）
cd site && npm ci         # 前端依赖
npm run site:dev          # 启动本地开发服务器
```

### 2. Local Runtime / CLI

```bash
dsh package list
dsh plugin install owner/plugin
dsh mcp install owner/server@1.2.0
dsh skill install helper@^1.0.0
dsh agent install worker --channel beta
dsh startup activate
```

无版本安装表示 `latest compatible stable`；实际安装仍由本地 Runtime 完成 Registry resolve、依赖/兼容性/权限预检与不可变来源验证。

### 3. 开放 API 速查

| 端点 | 说明 |
|---|---|
| `GET /api/v1` | API 服务索引与安装语义 |
| `GET /api/v1/capabilities` | 当前 Catalog/Registry/部署能力与一致性信息 |
| `GET /api/v1/registry/delta` | Registry Distribution V1 增量变更 |
| `GET /api/v1/registry/packages/:type/:id/versions` | 包版本、commit、artifact 与安全证据 |
| `GET /api/v1/plugins` | 插件列表（`?category=&verified=&search=&sort=&page=&per_page=`） |
| `GET /api/v1/plugins/:slug` | 兼容插件详情 |
| `GET /api/v1/search?q=` | 关键词搜索 |
| `GET /api/v1/categories` | 分类 + 计数 |
| `GET /api/v1/stats` | 统计 + Top 榜单 |
| `GET /api/v1/meta` | 数据更新时间 |
| `GET /api/v1/health` | 健康检查 |
| `POST /api/v1/mcp` | MCP（AI Agent） |
| `GET /catalog/plugins.json` | 兼容 Catalog 数据 |
| `GET /feed.xml` | RSS |

> API 使用示例、参数与 MCP 接入见站内 `/docs`。机器客户端可先读取 `/.well-known/dsh-marketplace.json` 或 `/api/v1/capabilities`；三平台静态站点提供同一发现契约。

### 4. 直接安装 DSH Marketplace MCP 包

本项目同时提供独立的只读 Marketplace MCP 包：

```bash
dsh mcp install dsh-go-marketplace@0.1.2
dsh startup activate
dsh mcp start dsh-go-marketplace
dsh mcp invoke dsh-go-marketplace search_plugins --input '{"q":"mcp","limit":10}'
```

安装前会执行 Registry、兼容性和权限预检；该包仅声明对 `dsh-go.pages.dev` 的网络访问，不会远程执行安装、shell 或重启客户端。

## 版本说明

项目需要区分三类版本：

- **Product Release**：GitHub Release，例如 `v0.1.2`；
- **Runtime/API compatibility**：当前兼容协议仍可保持 `0.1.0`；
- **独立 DSH package**：例如 `dsh-go-marketplace@0.1.2`，可以独立 SemVer 发布。

三者不要求永远相等，但 Release/manifest/文档必须明确各自含义，避免把兼容版本误当成产品发布版本。

## 如何收录你的插件

给 GitHub 仓库添加 `dsh-plugin` topic，下一次每日同步（或手动触发）后会进入发现流水线，并由 Registry pipeline 决定最终机器数据。

## 提交生态资源（人工）

Fork 后编辑 `catalog/overrides.json`（可选字段覆盖）并发 PR；或直接开 Issue，说明仓库地址。

## 许可证

MIT（数据来源 GitHub 公开仓库）。
