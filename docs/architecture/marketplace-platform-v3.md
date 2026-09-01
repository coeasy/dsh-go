# DSH Go Marketplace Platform V3

## 目标

`dsh-go` 同时承担三种职责：

1. 插件市场：发现 Plugin、MCP、Skill、Agent，并提供可分享的详情与安装计划。
2. 只读 API：为 DSH 客户端、MCP Client、自动化同步器提供稳定的 Registry V3 数据。
3. 三平台静态发布：Cloudflare Pages 作为 API 权威面，GitHub Pages 和 EdgeOne Pages 作为静态副本。

本版本保持 `0.1.0` 兼容契约，不修改上游 DeepSeek Harness，也不让远程 API 直接执行本地安装或重启。

## 分层架构

| 层 | 职责 | 权威数据/接口 |
|---|---|---|
| Discovery | 自动发现服务能力、API 和部署角色 | `/.well-known/dsh-marketplace.json` |
| Marketplace UI | 搜索、筛选、详情、趋势和安装入口 | Astro 静态站 |
| API Gateway | 统一响应头、ETag、只读查询 | `/api/v1/*` |
| Registry | 类型、版本、commit、artifact、权限和安全证据 | `catalog/registry-v3.json` |
| Distribution | 256 分片、包投影、增量变更 | `catalog/distribution-v1/*`、`/api/v1/registry/delta` |
| Runtime Bridge | 生成 `dsh` CLI 与 `dsh://install` 计划 | `local_install`，只计划不执行 |
| Deployment | 精确 SHA、Registry hash、Provider hash 收敛 | `version.json` + 三平台 smoke gate |

## 本轮已落地

### 1. 机器可发现入口

`/.well-known/dsh-marketplace.json` 声明：

- API 基地址与 OpenAPI 入口；
- Registry V3 和 Distribution V1；
- Plugin/MCP/Skill/Agent 四种类型；
- 只读安装计划、显式确认、安装后重启要求；
- Cloudflare Pages、GitHub Pages、EdgeOne Pages 的部署角色。

该文件是纯静态资源，三个 Pages 平台都能直接提供，不依赖 Cloudflare Functions。

### 2. API V1 服务索引与能力探针

- `GET /api/v1`：低成本服务索引，适合客户端首次探测。
- `GET /api/v1/capabilities`：返回当前 catalog/Registry 计数、hash、分发路径、安装语义和部署拓扑。
- `ETag` 与 `Cache-Control` 保持可缓存，未变化时返回 `304`。

### 3. Registry 增量消费

- `GET /api/v1/registry/delta` 暴露 Distribution V1 的 delta 文件。
- 客户端可用 `from_content_hash` 与 `to_content_hash` 判断是否需要完整拉取。
- 包含 changed/removed/counts，错误时 fail closed，不返回伪造的空 Registry。

### 4. 包版本历史

- `GET /api/v1/registry/packages/{type}/{id}/versions` 返回按 SemVer 降序排列的版本、commit、artifact、权限、依赖和安全证据。
- 支持 `channel=stable|beta|nightly|dev`。
- 使用按包和 channel 作用域的 ETag，避免全 Registry 更新造成无关包缓存失效。

### 5. 三平台一致性

每个构建流程都应验证：

1. 本地 `/.well-known` 文件格式；
2. `/version.json` 的精确 Git SHA；
3. Registry V3 content hash；
4. Provider Adapter Registry hash；
5. 生产站点重新读取 `/.well-known` 后声明正确的部署角色。

`platform-contract.yml` 提供定时/手动契约检查；EdgeOne 没有稳定自定义域名时保持跳过，避免把一次性签名预览 URL 当成长久健康地址。

### 6. 独立 DSH 插件包层

仓库根目录的 `dsh-package.json` 与 `packages/dsh-go-marketplace/dsh-package.json` 保持同一份可信清单，包 ID 为 `dsh-go-marketplace`，类型为远程 MCP。Registry V3 负责解析版本、权限、来源 commit 和 release artifact；Runtime 负责本地安装、权限确认、绑定和激活。

安装与激活：

```bash
dsh mcp install dsh-go-marketplace@0.1.2
dsh startup activate
dsh mcp start dsh-go-marketplace
```

该包只访问 `dsh-go.pages.dev` 的只读 Marketplace API，不包含 shell、文件系统、secret 或进程启动权限。当前包版本与产品 Release `v0.1.2` 对齐，独立包发布使用 `dsh-go-marketplace-v<version>` 标签，与产品版本标签隔离；`.github/workflows/release-dsh-marketplace.yml` 提供手动发布入口。Runtime/API 的兼容协议仍保持 `0.1.0`，不要求升级宿主客户端。

## 安装安全边界

远程市场只提供：

- 搜索和详情；
- 版本与 artifact 元数据；
- `dsh` CLI 命令；
- `dsh://install` 深链接；
- 本地安装计划。

远程市场不提供：

- 无确认安装；
- 远程执行 shell；
- 自动读取 secrets；
- 自动重启 DSH 客户端。

本地 Runtime 负责下载、SHA 校验、解包、权限确认、写入 Registry、激活和重启提示。

## 兼容性策略

- 旧客户端继续使用 `/api/v1/plugins`、`/api/v1/search` 和 `/api/v1/registry`。
- 新客户端优先探测 `/.well-known/dsh-marketplace.json` 或 `/api/v1/capabilities`。
- `catalog/plugins.json` 保留为兼容出口，Registry V3 是安装权威。
- API 只新增端点，不改变现有字段语义。
- 项目运行时、API 和新包模板仍以 `0.1.0` 作为兼容/默认版本；已发布的可信独立包可以按产品 Release 使用自己的 SemVer 版本。

## 下一阶段扩展点

- 将 Registry V3 的 package record 与独立 `dsh-package` Release 绑定；
- 引入签名/Provenance/SBOM 的客户端验证结果；
- 增加客户端兼容矩阵和 manifest 能力协商；
- 依据 `delta` 做本地缓存增量更新；
- 扩展独立包的 Skill/Agent 适配器，并保持最小权限模型；
- 将 API schema、OpenAPI 和 runtime 类型收敛为单一生成源。
