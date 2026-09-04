# DSH Go

DSH Go 是面向 DeepSeek Harness 生态的 **原生包管理器 + Registry/Distribution 基础设施 + Marketplace**。当前架构以 Package Protocol V2、Manifest V2、Registry V4、Resolver V2、Runtime State V4、API V2 为唯一权威，不保留旧接口兼容层。

API 权威入口：https://dsh-go.pages.dev/

> 核心边界：Marketplace/Edge 只负责发现、查询、解析和生成安装计划；**Local Runtime 是唯一有权执行安装、更新、回滚、状态写入和激活的组件**。远程页面/API 不能修改用户机器，也不会自动重启客户端。

## 最终架构

```text
Package Protocol V2 / Manifest V2
                ↓
Discovery → Candidate / Quarantine
                ↓
            Registry V4
                ↓
        Trust + Policy Engine
                ↓
            Resolver V2
                ↓
          Resolution Plan
                ↓
        Runtime Supervisor
                ↓
        CAS + Transaction
                ↓
        Runtime State V4
                ↓
       Activation Manager
                ↓
       Runtime Adapter ABI
                ↓
          Health / LKG
```

三条对外入口严格分层：

```text
CLI / Desktop / Deep Link / Local Host
                 ↓
          Runtime Supervisor

API V2 / MCP Tools V2 / Marketplace
                 ↓
       discovery + resolve only
```

横向基础能力包括 Secrets/Config、Audit/Observability、Environment Lock/Recovery。完整设计见：

- [`docs/architecture/dsh-go-v4-final-architecture.md`](docs/architecture/dsh-go-v4-final-architecture.md)
- [`docs/architecture/dsh-go-v4-hardened-runtime-architecture.md`](docs/architecture/dsh-go-v4-hardened-runtime-architecture.md)
- [`docs/plan/dsh-go-v4-architecture-hardening-optimization-plan.md`](docs/plan/dsh-go-v4-architecture-hardening-optimization-plan.md)

## 架构原则

- **唯一 Package Contract**：Plugin / MCP / Skill / Agent 均使用 `(type,id)` 身份和统一 SemVer/Channel 规则。
- **唯一 Manifest**：可安装包只认 `dsh-package.json`（Manifest V2）；其他历史 manifest 最多作为发现线索，不具备安装权威。
- **唯一 Registry 权威**：Registry V4 保存 package/release/immutable commit/artifact/security 元数据；Candidate/Quarantine 不是安装权威。
- **唯一 Resolver**：Edge 与 Local Runtime 共用 `packages/resolver`，Resolver 本身不访问网络、不写磁盘。
- **唯一 Runtime 写入口**：所有本地 mutation 必须经过 Runtime Supervisor；CLI、Desktop、Deep Link、Local Host 都不能直接写 Runtime State。
- **事务安装**：解析 → Policy → Security → CAS → Transaction → Runtime State，一次失败不得产生半安装状态。
- **显式激活**：安装/更新完成后进入 pending activation；Activation Manager 执行预检、Adapter 绑定、健康检查和 Last-Known-Good 回退。
- **可信度不造假**：Stars、SHA256、声明存在 signature 都不等于 Trusted；Trusted 必须来自已验证 Publisher Ownership + 真正的 cryptographic signer verification，并受 Trust Root/revocation 约束。
- **不自动重启**：任何包操作都不会自动重启 DSH 客户端。

## Package Protocol V2

标准坐标：

```text
plugin:owner/package@^1.2.0
mcp:owner/server@2.0.0
skill:owner/skill@*
agent:owner/agent@~3.1.0
```

支持 channel：`stable`、`beta`、`nightly`、`dev`。类型必须显式提供，不存在隐式 plugin，也不存在 `github:` 安装坐标。

## Local Runtime / CLI

```bash
# 查询/解析
dsh package plan plugin:owner/package@^1.2.0
dsh package info plugin:owner/package@1.2.3
dsh package list

# 本地 mutation 必须显式确认
dsh package install plugin:owner/package@^1.2.0 --yes
dsh package update plugin:owner/package@^1.3.0 --yes
dsh package rollback plugin:owner/package --yes
dsh package remove plugin:owner/package --yes

# Runtime / Registry / Environment
dsh runtime status --json
dsh runtime activate --yes
dsh registry status --json
dsh environment lock
dsh environment verify-lock
dsh environment restore --yes
```

Canonical Deep Link：

```text
dsh://package/install?spec=plugin%3Aowner%2Fpackage%40%5E1.2.0&channel=stable
```

Deep Link 不能覆盖本地 Registry，最终安装仍需 Local Runtime 明确批准。

## API V2 / MCP Tools V2

远程接口只提供 discovery / resolve / install-plan：

| 接口 | 用途 |
|---|---|
| `GET /api/v2` | API capability map |
| `GET /api/v2/health` | Registry V4 健康状态与 revision |
| `GET /api/v2/packages` | 包查询 |
| `GET /api/v2/packages/:type/:id` | 包与 release 详情 |
| `GET /api/v2/search?q=` | Registry/Search Index 查询 |
| `POST /api/v2/resolve` | Resolver V2 依赖解析 |
| `POST /api/v2/install-plan` | 生成本地安装计划，不执行安装 |
| `GET /api/v2/publishers` | Publisher 信息 |
| `GET /api/v2/advisories` | 安全公告 |
| `GET /api/v2/registry/revision` | Registry revision |
| `GET /api/v2/registry/delta` | Distribution V2 增量协商 |
| `POST /api/v2/mcp` | MCP Tools V2 JSON-RPC |

机器客户端应先读取 `/.well-known/dsh-marketplace.json`。OpenAPI 位于 `/openapi.json`。

## Registry / Distribution

公开机器数据：

```text
/catalog/registry-v4.json
/catalog/registry-v4/index.json
/catalog/search-index-v3.json
/.well-known/dsh-marketplace.json
/schemas/dsh-marketplace-discovery-v2.schema.json
```

外部 GitHub 发现数据必须先经过 Candidate/Quarantine。缺少 Manifest V2、无法解析 immutable commit、身份冲突或安全条件不满足的资源可以继续在发现层显示，但不会进入可安装 Registry authority。

## Marketplace

Marketplace 是人类发现平面，不拥有安装权限。当前站点支持 English、简体中文、日本語、한국어、Español；搜索使用 Search Index V3。详情页只为满足当前详情阈值策略且存在安全 release 的包生成，低阈值资源直接回到源码/发现入口，避免生成大量无效详情页。

<!-- HOT-PLUGINS:START -->
## 🔥 最近热门推荐（300-5000★）

> 自动生成 · 按当前同步结果更新；该榜单只用于发现，不代表安全或 Trusted 判定。

| # | 插件 | ★ Stars | 语言 | 最近更新 | 简介 |
|---|------|---------|------|----------|------|
| 1 | [modlens](https://github.com/liustack/modlens) | 3.9k | TypeScript | 2026-09-01 | The first vision plugin for DeepSeek Harne… |
| 2 | [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | 3.3k | TypeScript | 2026-09-03 | 开放的侧边栏底座，支持三方拓展注册新侧边栏页面。 |
| 3 | [dsh-plugin-radar](https://github.com/AdamPlatin123/dsh-plugin-radar) | 1.4k | Python | 2026-09-04 | DSH Plugin Radar — 开源 DSH 插件生态雷达。 |
| 4 | [dsh-browser](https://github.com/Lum1104/dsh-browser) | 566 | TypeScript | 2026-09-04 | Chrome sidebar extension for DeepSeek Harness. |
| 5 | [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) | 2.8k | TypeScript | 2026-09-04 | DSH TUI plugin. |
| 6 | [oh-dsh](https://github.com/hust-open-atom-club/oh-dsh) | 302 | TypeScript | 2026-09-04 | DSH runtime / Desktop / Web / TUI. |
| 7 | [dshcode](https://github.com/whitelonng/dshcode) | 711 | TypeScript | 2026-09-04 | Community desktop companion. |
| 8 | [dsh-plugin-subscriptions](https://github.com/V1ki/dsh-plugin-subscriptions) | 318 | TypeScript | 2026-09-04 | Provider subscriptions integration. |
| 9 | [dsh-mnemon](https://github.com/omdsh-dev/dsh-mnemon) | 323 | TypeScript | 2026-09-04 | Memory control plane. |
| 10 | [dsh-desktop](https://github.com/vibeinging/dsh-desktop) | 636 | JavaScript | 2026-09-04 | DeepSeek Harness Desktop App. |

更新时间：2026-09-04
<!-- HOT-PLUGINS:END -->

## 同步与部署

Registry V4 workflow 每天 UTC `00:18 / 06:18 / 12:18 / 18:18` 触发，并支持手动 full/incremental。Discovery collector 只产生候选数据，随后统一构建 Registry V4、Search Index V3 和 Distribution V2。

生产部署要求 Cloudflare Pages、GitHub Pages、EdgeOne Pages 对同一个 commit SHA、Registry V4 revision 和必要 provider artifact 达成收敛；Cloudflare Functions 承担 API V2 权威面，静态平台不执行本地 mutation。

## 本地开发与验证

```bash
npm ci
cd site && npm ci && cd ..

npm run contract:check
npm run architecture:check
npm run typecheck
npm run lint
npm test
npm run site:build
npm run deploy:gate
```

`npm run architecture:check` 会阻止旧 API/Runtime/Registry surface、缺失相对导入、跨层依赖、重复 Protocol/Resolver 权威以及前端绕过 Runtime Supervisor 等架构回退。

## 独立 Marketplace MCP 包

```text
mcp:coeasy/dsh-go-marketplace@0.1.2
```

```bash
dsh package install mcp:coeasy/dsh-go-marketplace@0.1.2 --yes
dsh runtime activate --yes
```

该包仅提供只读生态发现能力，不拥有本地安装写权限。

## 版本语义

项目区分三类 SemVer：

- **Product Release**：GitHub Release；
- **Runtime/API compatibility**：协议和 Runtime 兼容版本；
- **独立 DSH package**：Marketplace MCP、Desktop plugin 等包自身的版本。

三者允许独立演进，但每个发布面必须明确自身版本含义，不把兼容版本误当成产品版本。

## 收录资源

GitHub discovery 负责发现候选仓库；真正成为可安装包必须提供合法的 `dsh-package.json` Manifest V2，并通过 immutable commit、Registry、Policy/Security 等验证。人工元数据覆盖可通过 `catalog/overrides.json` 提交 PR，但覆盖不能把非 Manifest V2 资源提升成可安装 authority。

## License

MIT（生态发现数据来源于 GitHub 公开仓库）。
