# DSH Go 破坏性架构升级与全面优化改进总方案

> 状态：执行基线 / Master Plan  
> 决策：**不再兼容旧接口，不保留旧协议适配层，不为旧 CLI / API / Deep Link / Registry 镜像维持双轨实现。**  
> 目标：以最优长期架构为准，对 `dsh-go` 的 Package Manager、Registry、Runtime、API、MCP、Marketplace、i18n、Security、CI/CD 与文档体系进行一次完整收敛重构。

---

## 0. 执行结论

本轮升级不再采用“旧接口继续保留 + 新接口逐步旁路”的兼容策略，而是直接建立新的唯一权威模型，并把所有上层能力统一到同一条链路。

最终只允许存在以下六个唯一权威：

1. **一个 Package Protocol Core**：统一包身份、版本范围、依赖、Channel、Manifest、请求与错误码；
2. **一个 Registry Model**：统一远程包、版本、Artifact、安全证据与发布者身份；
3. **一个 Resolver**：CLI、API、MCP、Web、Profile、Bundle 都复用相同解析语义；
4. **一个 Local Runtime State**：安装、更新、删除、启停、回滚、激活共用同一状态机；
5. **一个 i18n Message Contract**：静态页面与动态浏览器内容使用同一套翻译键；
6. **一个 Release / Deployment Gate**：所有平台发布同一 commit、同一 Registry hash、同一 Provider hash、同一构建契约。

旧协议一律删除，不增加兼容桥，不保留“双写”和“兼容镜像”作为长期运行逻辑。

---

# 1. 产品重新定位

`dsh-go` 目标不是“插件导航站”，而是完整的 DSH 生态基础设施：

```text
DSH Ecosystem Platform
│
├─ A. Native Package Manager
│  ├─ CLI
│  ├─ Deep Link
│  ├─ Local Runtime
│  ├─ Resolver / Dependency Solver
│  ├─ Transaction / Rollback
│  ├─ Local Registry / Lockfile
│  └─ Activation / Bindings
│
├─ B. Registry & Distribution Plane
│  ├─ Source Discovery
│  ├─ Registry V4
│  ├─ Distribution V2
│  ├─ Search Index
│  ├─ Advisory / Trust Metadata
│  └─ Publisher Identity
│
├─ C. Edge API & MCP Plane
│  ├─ REST API V2
│  ├─ MCP Tools V2
│  ├─ Install Plan
│  ├─ Search / Package / Publisher / Trust
│  └─ Capability Discovery
│
└─ D. Marketplace Discovery Plane
   ├─ Astro UI
   ├─ Plugin / MCP / Skill / Agent
   ├─ Search / Trending / Publisher / Trust
   ├─ Profiles / Bundles
   ├─ i18n
   └─ Open in DSH / CLI Copy
```

关键边界：

- Web / API / MCP **只能发现和生成计划**；
- Local Runtime **唯一拥有本机写权限**；
- Registry **只描述可安装事实，不直接执行代码**；
- Package Manager **统一管理 Plugin / MCP / Skill / Agent**；
- 不修改上游 DeepSeek Harness；
- 安装、更新、回滚后默认不自动重启客户端；
- 用户显式激活 / 客户端下次启动时完成绑定。

---

# 2. 本次升级的强制原则

## 2.1 不再兼容旧接口

以下兼容策略全部停止：

- 不保留旧 CLI 命令作为 alias；
- 不保留旧 REST 路由作为 redirect / adapter；
- 不保留旧 Deep Link 参数格式；
- 不保留 Registry 的 legacy projection 作为 Package Manager 输入；
- 不允许 `plugins[]` 与 `packages[]` 双写作为本地权威；
- 不允许 Runtime 与 Edge 各维护一套 SemVer；
- 不允许页面内自行定义第二套包类型识别规则；
- 不允许 Marketplace 自己拼装“猜测式安装命令”；
- 不保留旧错误字符串作为协议；统一结构化错误码。

对于历史用户数据：

- 新 Runtime 不在核心路径中维护旧 schema 兼容代码；
- 发现旧状态文件时 fail-fast，并明确提示“当前状态版本不受支持”；
- 如确有迁移需要，可提供**一次性离线迁移工具**，但迁移代码不得进入主 Runtime 热路径；
- 新版本上线后只支持新的 Runtime State Schema。

## 2.2 删除重复实现优先于新增功能

优先级：

```text
P0 单一协议 / 单一状态 / 单一 Resolver
  > P1 Runtime 生命周期 / i18n / Registry
  > P2 Security / Distribution / CI
  > P3 新 Marketplace 功能
```

在 P0/P1 完成前，禁止继续横向增加新的安装协议、新状态模型、新独立 Resolver。

## 2.3 Fail Closed

下列情况全部拒绝继续安装：

- package identity 不合法；
- version range 不合法；
- 依赖无法求解；
- artifact digest 不匹配；
- commit 不可证明；
- revoked；
- critical advisory 命中；
- permission 未确认；
- compatibility 不满足；
- cryptographic trust 策略要求签名但无法验证；
- Registry release 信息不完整。

---

# 3. 目标仓库结构

建议将当前散落的根目录、`runtime/`、`functions/`、`site/` 逐步收敛为 workspace 化结构：

```text
apps/
├─ marketplace/                 # Astro Web
└─ edge-api/                    # Cloudflare Functions / Edge API

packages/
├─ protocol-core/               # Package identity/request/semver/errors
├─ registry-core/               # Registry V4 schema/validation/projections
├─ resolver/                    # version + dependency + channel resolution
├─ security-core/               # advisory/trust/permission/compatibility
├─ runtime-core/                # transaction/state/install/update/remove
├─ runtime-host/                # host bridge / deeplink / client integration
├─ cli/                         # canonical dsh package CLI
├─ distribution/                # Registry Distribution V2
├─ marketplace-core/            # shared discovery/ranking/policy
├─ i18n/                        # typed message contract
└─ dsh-go-marketplace-plugin/   # 独立 DSH Marketplace MCP 包

config/
├─ marketplace-policy.json
├─ trust-policy.json
├─ registry-policy.json
└─ release-policy.json

catalog/
└─ source snapshots / overrides

scripts/
├─ sync/
├─ release/
├─ deploy/
└─ maintenance/

tests/
├─ protocol/
├─ registry/
├─ resolver/
├─ runtime/
├─ security/
├─ api/
├─ marketplace/
├─ e2e/
└─ release/

docs/
├─ architecture/
├─ contracts/
├─ plan/
├─ operations/
└─ history/
```

说明：

- 不要求第一笔提交就物理搬迁所有目录；
- 先完成“canonical ownership”，再移动文件；
- 每次移动都必须通过 import boundary test 防止循环依赖；
- 所有公共包统一 ESM；
- 新共享核心优先 TypeScript，构建输出 Node/Edge 均可消费的 ESM。

---

# 4. Canonical Package Protocol Core

这是本轮最重要的 P0。

当前 Runtime 与 Edge API 分别维护 package request / SemVer / type / channel 语义，必须彻底合并。

目标包：

```text
packages/protocol-core
```

## 4.1 唯一包身份

统一使用：

```text
PackageType = plugin | mcp | skill | agent
PackageId   = owner/name 或稳定 registry id
PackageKey  = <type>:<id>
Coordinate  = <type>:<id>@<version>
```

示例：

```text
plugin:coeasy/example@1.4.2
mcp:coeasy/example-mcp@2.0.0
skill:coeasy/research@1.1.0
agent:coeasy/coder@3.2.1
```

要求：

- `(type, id)` 唯一；
- 同名不同类型允许存在；
- Registry 内版本必须为严格 SemVer；
- package request 可以使用 SemVer Range；
- canonical ID 大小写归一化；
- display name 与 id 分离。

## 4.2 唯一请求结构

```ts
interface PackageRequest {
  type: PackageType;
  id: string;
  range: string;
  channel: ReleaseChannel;
  registry?: string;
}
```

禁止再出现：

- `version` / `versionRange` 两个字段语义重叠；
- Edge 使用 `versionRange`、Runtime 使用 `version` 的双轨；
- type 缺失时在不同层做不同推断。

唯一规则：

- 外部输入必须在进入 Resolver 前 canonicalize；
- Registry 内部记录必须显式 type；
- 只有 CLI shorthand 可通过命令上下文补 type；
- API / MCP / Deep Link 必须显式 type。

## 4.3 SemVer

只保留一个实现：

```text
parseVersion
compareVersion
satisfiesRange
selectHighest
```

必须覆盖：

- exact；
- `^`；
- `~`；
- `>` / `>=` / `<` / `<=`；
- wildcard；
- OR range；
- prerelease；
- build metadata；
- invalid input；
- `0.x` caret 规则。

禁止 Runtime / Edge / UI 再各自实现排序。

## 4.4 统一错误码

所有 CLI / API / MCP / Host 共用：

```text
DSH_INVALID_PACKAGE_ID
DSH_INVALID_PACKAGE_TYPE
DSH_INVALID_VERSION_RANGE
DSH_UNSUPPORTED_CHANNEL
DSH_PACKAGE_NOT_FOUND
DSH_PACKAGE_AMBIGUOUS
DSH_DEPENDENCY_CONFLICT
DSH_PACKAGE_REVOKED
DSH_PACKAGE_YANKED
DSH_SECURITY_ADVISORY_BLOCKED
DSH_INCOMPATIBLE_RUNTIME
DSH_PERMISSION_DENIED
DSH_ARTIFACT_DIGEST_MISMATCH
DSH_SIGNATURE_REQUIRED
DSH_SIGNATURE_INVALID
DSH_TRANSACTION_CONFLICT
DSH_STATE_SCHEMA_UNSUPPORTED
DSH_RESTART_REQUIRED
```

CLI 的人类文本只是错误码的渲染结果，不是协议本身。

---

# 5. Manifest V2

旧的多个 manifest candidates 最终收敛为一个 DSH 原生 Manifest：

```text
dsh-package.json
```

其他历史 manifest 不再作为正式输入。

目标结构：

```json
{
  "manifest_version": 2,
  "id": "coeasy/example",
  "type": "plugin",
  "version": "1.2.3",
  "name": "Example",
  "description": "...",
  "entrypoints": {},
  "dependencies": [],
  "permissions": [],
  "compatibility": {},
  "publisher": {},
  "security": {},
  "metadata": {}
}
```

核心要求：

- identity 字段不可由 README 猜测；
- version 不允许隐式默认；
- type 不允许从 capabilities 二次推断；
- permissions 必须声明；
- runtime entrypoint 必须结构化；
- dependencies 使用 canonical PackageRequest；
- publisher identity 与 repository owner 分开；
- security evidence 只存引用与 digest，不把“存在”视为“可信”。

---

# 6. Registry V4

Registry V4 作为远程唯一包权威。

## 6.1 顶层结构

```text
Registry
├─ schema_version
├─ generated_at
├─ revision
├─ packages[]
├─ publishers[]
├─ advisories[]
└─ metadata
```

Package 不再以“每个版本一条平铺 plugin 记录”为唯一长期结构，改为：

```ts
interface RegistryPackage {
  type: PackageType;
  id: string;
  publisher_id: string;
  source: RepositorySource;
  metadata: PackageMetadata;
  releases: RegistryRelease[];
}
```

Release：

```ts
interface RegistryRelease {
  version: string;
  channel: ReleaseChannel;
  commit: string;
  published_at: string;
  dependencies: PackageDependency[];
  compatibility: CompatibilityPolicy;
  permissions: Permission[];
  artifact: ArtifactDescriptor;
  security: SecurityEvidence;
  yanked: boolean;
  revoked: boolean;
}
```

## 6.2 Registry 权威规则

- package identity：Registry V4；
- release version：Registry V4；
- immutable commit：Registry V4；
- artifact digest：Registry V4；
- advisory：Registry V4；
- publisher：Registry V4；
- stars / trend：只作为 discovery metadata，不参与 package identity；
- Catalog 只作为 Registry 构建输入，不是 Runtime 安装权威。

## 6.3 删除 legacy projection 依赖

Runtime 禁止再读取：

```text
catalog/plugins.json
legacy plugins[] mirror
页面生成的 install script 作为权威
```

这些可以作为静态发现产物存在，但不能参与 Runtime resolve。

---

# 7. Registry Distribution V2

目标解决：

- 大 Registry 单文件体积；
- 三平台分发；
- 增量拉取；
- immutable cache；
- 快速 package lookup；
- 离线 cache。

结构：

```text
/catalog/registry-v4/
├─ index.json
├─ packages/<hash-prefix>/<package-key>.json
├─ publishers/<publisher>.json
├─ advisories/<id>.json
├─ delta/<revision>.json
└─ signatures/
```

Index 只包含：

- revision；
- content hash；
- package map；
- shard metadata；
- delta base；
- signature / provenance reference。

Runtime 读取策略：

```text
conditional index request
   ↓ unchanged → use local cache
changed
   ↓ delta available → apply delta
no delta
   ↓ fetch changed package shards only
```

禁止每次安装下载完整 Registry。

---

# 8. Resolver V2

只保留一个 Resolver：

```text
packages/resolver
```

输入：

```text
PackageRequest + RegistrySnapshot + RuntimeEnvironment
```

输出：

```ts
interface ResolutionPlan {
  root: ResolvedRelease;
  graph: ResolvedNode[];
  order: PackageKey[];
  permissions: PermissionDelta[];
  trust: TrustDecision[];
  conflicts: [];
  restart_required: boolean;
}
```

Resolver 责任：

1. normalize request；
2. channel filter；
3. range filter；
4. revoked / yanked / advisory filter；
5. compatibility filter；
6. dependency graph expansion；
7. constraint merge；
8. cycle detection；
9. conflict detection；
10. deterministic highest-safe-version selection；
11. stable install order；
12. output immutable plan。

禁止 Installer 在执行阶段重新做版本选择。

## 8.1 确定性

相同：

```text
Registry revision + PackageRequest + RuntimeEnvironment
```

必须产生相同 resolution hash。

该 hash 写入 transaction 与 lockfile。

---

# 9. Canonical CLI V2

旧 type-specific 命令不再保留。

只提供统一 Package Manager：

```text
dsh package search <query>
dsh package info <type:id>
dsh package install <type:id>@<range>
dsh package update <type:id>[@<range>]
dsh package remove <type:id>
dsh package list
dsh package status <type:id>
dsh package enable <type:id>
dsh package disable <type:id>
dsh package rollback <type:id> [--to <version>]
dsh package doctor [type:id]
dsh package verify [type:id]
dsh package lock
dsh package restore <lockfile>
```

机器输出统一：

```text
--json
```

JSON envelope：

```json
{
  "ok": true,
  "code": "DSH_OK",
  "data": {},
  "warnings": [],
  "meta": {}
}
```

失败：

```json
{
  "ok": false,
  "code": "DSH_DEPENDENCY_CONFLICT",
  "error": {
    "message": "...",
    "details": {}
  }
}
```

禁止脚本依赖 console 文本解析。

---

# 10. Canonical Deep Link V2

只保留一种格式：

```text
dsh://package/install?spec=<urlencoded-coordinate>&channel=stable
```

例如：

```text
dsh://package/install?spec=plugin%3Acoeasy%2Fexample%40%5E1.2.0&channel=stable
```

Host 必须执行：

```text
parse
→ canonicalize
→ local confirmation
→ resolver plan
→ permission/trust confirmation
→ runtime transaction
```

禁止：

- 网页传 shell command；
- 网页指定本地安装目录；
- 网页直接触发 restart；
- 网页绕过 permission confirmation。

---

# 11. REST API V2

旧 `/api/v1/*` 不再作为兼容接口长期保留。

目标接口：

```text
GET  /api/v2
GET  /api/v2/capabilities
GET  /api/v2/packages
GET  /api/v2/packages/:type/:id
GET  /api/v2/packages/:type/:id/releases
GET  /api/v2/packages/:type/:id/releases/:version
GET  /api/v2/search
GET  /api/v2/publishers
GET  /api/v2/publishers/:id
GET  /api/v2/advisories
GET  /api/v2/advisories/:id
POST /api/v2/resolve
POST /api/v2/install-plan
GET  /api/v2/registry/revision
GET  /api/v2/registry/delta
GET  /api/v2/health
```

统一 envelope：

```json
{
  "data": {},
  "meta": {
    "registry_revision": "...",
    "request_id": "..."
  }
}
```

错误：

```json
{
  "error": {
    "code": "DSH_PACKAGE_NOT_FOUND",
    "message": "...",
    "details": {}
  },
  "meta": {
    "request_id": "..."
  }
}
```

API `/resolve` 必须直接调用 shared Resolver Core，不复制 Edge Resolver。

---

# 12. MCP Tools V2

MCP 工具命名统一：

```text
package_search
package_get
package_releases
package_resolve
package_install_plan
publisher_get
advisory_get
registry_status
```

MCP 不执行本地写操作。

禁止：

- MCP 远端直接 install；
- MCP 返回 shell 拼接命令作为执行协议；
- MCP 自己实现另一套 package parsing。

---

# 13. Local Runtime V4

目标目录：

```text
packages/runtime-core
```

## 13.1 状态机

统一状态：

```text
ABSENT
  ↓ install
STAGED
  ↓ verify
INSTALLED
  ↓ activate
ACTIVE
  ↓ disable
DISABLED
  ↓ update
STAGED_UPDATE
  ↓ commit
INSTALLED / ACTIVE
  ↓ remove
ABSENT
```

失败路径：

```text
STAGED / STAGED_UPDATE
  ↓ failure
ROLLING_BACK
  ↓
previous stable state
```

任何模块不能直接跳写 ACTIVE。

## 13.2 Runtime State Schema V4

```ts
interface RuntimeState {
  schema_version: 4;
  generation: number;
  packages: InstalledPackage[];
  transactions: TransactionSummary[];
  pending_restart: PackageKey[];
  environment: RuntimeEnvironmentIdentity;
}
```

删除 `plugins[]` 兼容镜像。

InstalledPackage：

```ts
interface InstalledPackage {
  key: PackageKey;
  version: string;
  channel: ReleaseChannel;
  registry_revision: string;
  resolution_hash: string;
  source_commit: string;
  artifact_digest: string;
  install_path: string;
  enabled: boolean;
  active: boolean;
  restart_required: boolean;
  installed_at: string;
  updated_at: string;
}
```

## 13.3 并发与原子性

保留并强化当前已有能力：

- cross-process lock；
- generation CAS；
- atomic temp + rename；
- stale owner detection；
- transaction journal；
- crash recovery。

任何 Runtime State 写入必须通过一个 Store API。

禁止其他模块直接 `writeFile(registry.json)`。

---

# 14. Transaction Engine V2

Transaction phases：

```text
PLAN
→ FETCH
→ VERIFY
→ EXTRACT
→ STAGE
→ PRECOMMIT
→ COMMIT_FILES
→ COMMIT_STATE
→ FINALIZE
```

失败时：

```text
ROLLBACK_FILES
→ ROLLBACK_STATE
→ CLEANUP
```

Transaction record：

```ts
interface TransactionRecord {
  id: string;
  operation: 'install' | 'update' | 'remove' | 'rollback';
  state: string;
  package_key: string;
  from_version?: string;
  to_version?: string;
  registry_revision: string;
  resolution_hash: string;
  started_at: string;
  updated_at: string;
}
```

文件系统与 state 必须保证：

- 不出现“文件已替换但 Registry 未提交”的永久半状态；
- 不出现“Registry 已显示新版本但文件不存在”；
- interrupted transaction 可恢复或回滚。

---

# 15. Artifact Installer

Artifact 获取与安装必须独立于 Package 类型。

统一流程：

```text
release.artifact
↓
HTTPS fetch
↓
size limit
↓
content digest
↓
signature/provenance
↓
safe extraction
↓
manifest verify
↓
staging directory
↓
transaction commit
```

必须防止：

- zip slip；
- symlink escape；
- absolute path；
- path traversal；
- oversized archive；
- decompression bomb；
- digest mismatch；
- mutable GitHub branch artifact。

优先只接受：

- immutable release artifact；
- immutable commit archive；
- Registry 声明 digest 的包。

---

# 16. Security / Trust V2

## 16.1 Trust 与 Popularity 完全分离

Stars 不参与 Trusted 判定。

Trust Signal：

```text
repository ownership
artifact digest
immutable commit
provenance
SBOM
cryptographic signature
publisher identity
advisory state
revocation state
```

## 16.2 Trusted Release 定义

只有满足指定 trust policy 才允许标记：

```text
Trusted
```

至少包含：

- publisher identity 可验证；
- repository ownership 可验证；
- artifact digest 正确；
- cryptographic signature 验证通过；
- signer identity 符合 policy；
- 无 revoke；
- 无阻断级 advisory。

“有 signature URL”不等于“signature verified”。

## 16.3 密码学实现

建议优先：

- Sigstore / cosign compatible verification；
- keyless identity policy；
- GitHub OIDC provenance；
- 可选组织级 public key trust root。

新增：

```text
config/trust-policy.json
```

Trust decision 必须结构化：

```ts
interface TrustDecision {
  status: 'trusted' | 'verified' | 'community' | 'blocked';
  reasons: TrustReason[];
  signer_verified: boolean;
  provenance_verified: boolean;
  digest_verified: boolean;
}
```

---

# 17. Permission Model V2

统一最小权限：

```text
network
filesystem.read
filesystem.write
process.spawn
clipboard
notifications
secrets.read
host.ui
host.lifecycle
```

Manifest 只声明能力，Runtime 决定授权。

安装计划必须计算：

```text
new permissions
removed permissions
unchanged permissions
```

更新时如果增加权限，必须重新确认。

禁止安装器根据任意 README 文本推断权限。

---

# 18. Compatibility Model V2

统一：

```text
os
arch
node
runtime
client
host_api
```

Preflight 顺序：

```text
package request
→ release select
→ compatibility
→ dependency
→ trust
→ permissions
→ transaction
```

不兼容在下载 artifact 前尽早失败。

---

# 19. Startup / Activation V2

Package 安装成功与 Runtime 激活必须解耦。

安装：

```text
installed=true
active=false
restart_required=true (if required)
```

客户端下一次启动：

```text
load Runtime State
→ validate installed package
→ build binding plan
→ activate eligible packages
→ write activation result
```

插件异常必须：

- 不阻塞 Harness Web 主界面；
- 不阻塞其他包激活；
- 记录独立故障；
- 可被 doctor 检测；
- 支持 disable 后继续启动。

---

# 20. Host Bridge V2

Host Bridge 只做边界层：

```text
Deep Link / Desktop / Client request
→ validate transport
→ protocol-core normalize
→ user confirmation
→ runtime-core
```

Host Bridge 不再：

- 实现 SemVer；
- 直接写 Runtime State；
- 自己做 Artifact 解压；
- 自己做依赖解析。

---

# 21. Marketplace V2

Marketplace 是“发现 UI”，不是第二 Package Manager。

## 21.1 卡片数据

Card 只消费统一 View Model：

```ts
interface MarketplacePackageView {
  key: PackageKey;
  latest_version: string;
  source_url: string;
  description: string;
  stars: number;
  updated_at: string;
  trust: TrustSummary;
  detail_available: boolean;
}
```

## 21.2 安装入口

只生成：

```text
canonical CLI command
canonical dsh:// Deep Link
```

安装 command 必须来自 protocol formatter，而不是页面自行拼字符串。

## 21.3 Stars Policy

当前策略集中在一个 policy 文件中：

```text
home_min_stars
home_max_stars
home_hard_max_stars
home_top_limit
detail_min_stars
```

禁止页面 / 构建器 / install script generator 再独立硬编码。

## 21.4 详情页

当前规则继续采用：

```text
>= 200 Stars → 可生成静态详情页
< 200 Stars  → 仍可搜索、发现、安装，但直接使用 source / install action
```

如果将来策略变化，只改一个 policy。

---

# 22. i18n Core V2

删除：

- 页面内 inline dictionary；
- Marketplace 独立 dictionary；
- legacy exact-text walker；
- 多套翻译事件协议。

目标：

```text
packages/i18n/messages/
├─ en.ts
├─ zh-CN.ts
├─ ja.ts
├─ ko.ts
└─ es.ts
```

定义：

```ts
interface Messages {
  nav: {...}
  marketplace: {...}
  publisher: {...}
  trust: {...}
  package: {...}
  common: {...}
}
```

要求：

- 所有语言必须通过类型检查；
- key 缺失 CI 失败；
- Astro 静态文本与浏览器 runtime 共用消息源；
- dynamic rerender 自动消费当前 locale；
- package README / description 不做自动翻译，避免篡改第三方内容；
- locale 切换不重新加载完整 Registry。

---

# 23. Marketplace Search V2

Search Index 只作为发现投影，不作为安装权威。

索引字段：

```text
package key
name
description
publisher
tags
category
stars
updated_at
trust tier
latest version
```

搜索结果点击详情时再通过 Registry Package View 确认详情能力。

禁止把 Search Index 中的版本字段直接用于安装最终决策。

---

# 24. Sync Pipeline V4

目标链：

```text
Source Discovery
→ Raw Snapshot
→ Normalize
→ Validate Manifest / Metadata
→ Registry V4 Build
→ Registry Audit
→ Distribution V2
→ Search Index
→ Marketplace Projection
→ README / feed optional projections
```

每一步都生成 hash 和统计信息。

必须满足：

- 输入 revision 可追踪；
- 输出 deterministic；
- invalid package 单独 quarantine，不污染整个 Registry；
- critical Registry structural error 直接阻止发布；
- 自动同步不得直接覆盖不可重复生成的人工状态。

---

# 25. Publisher Model V2

Publisher 独立实体：

```ts
interface Publisher {
  id: string;
  display_name: string;
  github_owner?: string;
  repositories: string[];
  ownership_status: string;
  trust_policy?: string;
}
```

Package 通过 `publisher_id` 引用。

禁止每个页面自己从 `repo.split('/')[0]` 推断 publisher 作为最终权威。

---

# 26. Profiles / Bundles V2

Profile 与 Bundle 不再自己解析包。

统一只包含 PackageRequest：

```json
{
  "packages": [
    {"type":"plugin","id":"coeasy/a","range":"^1.0.0","channel":"stable"},
    {"type":"mcp","id":"coeasy/b","range":"~2.2.0","channel":"stable"}
  ]
}
```

执行时整体交给 Resolver，产生单一依赖图与 transaction plan。

禁止循环调用 `install` 多次形成半安装 profile。

---

# 27. Lockfile / Environment Reproducibility

新增规范化 lockfile：

```text
dsh.lock.json
```

包含：

```text
schema_version
registry_revision
environment
resolved packages
exact versions
commits
artifact digests
resolution hash
trust result
```

`dsh package restore` 必须验证：

- registry revision / immutable release；
- artifact digest；
- runtime environment；
- trust policy。

Lockfile 不允许使用 range 作为最终 resolved version。

---

# 28. Observability / Doctor

统一 Event：

```text
registry.refresh
resolve.start
resolve.complete
install.start
artifact.verified
transaction.commit
transaction.rollback
activation.success
activation.failure
security.blocked
permission.requested
```

每条 event：

```text
request_id / transaction_id
package_key
version
registry_revision
timestamp
duration
result code
```

Doctor 至少覆盖：

- state schema；
- broken install path；
- missing artifact；
- digest drift；
- pending transaction；
- stale lock；
- unresolved dependency；
- incompatible runtime；
- revoked installed package；
- permission mismatch；
- activation failure。

---

# 29. CI 架构收敛

现有 workflow 已覆盖很多能力，但重复 gate 较多。

目标拆为 reusable workflows：

```text
_reusable-code-quality.yml
_reusable-runtime-test.yml
_reusable-site-build.yml
_reusable-registry-gate.yml
_reusable-security-gate.yml
_reusable-release-freeze.yml
_reusable-deploy-contract.yml
```

入口 workflow：

```text
ci.yml
runtime.yml
security.yml
release.yml
deploy-cloudflare.yml
deploy-github-pages.yml
deploy-edgeone.yml
monitor.yml
sync.yml
```

所有入口复用相同 gate，不再复制 shell 片段。

## 29.1 Required Gates

任何合并必须通过：

```text
format/lint
typecheck
unit
protocol conformance
resolver properties
runtime lifecycle
security
site check
site build
registry validation
contract tests
E2E
```

Release 额外：

```text
npm audit / OSV
SBOM
artifact pack verification
immutable revision
production file limits
three-platform contract
```

---

# 30. 三平台部署模型

保持最清晰的权威：

```text
Cloudflare Pages = API authority + static site
GitHub Pages      = static mirror
EdgeOne Pages     = static mirror
```

三平台必须来自同一 release revision。

最终 convergence gate：

```text
commit SHA
Registry revision
Registry content hash
Provider Registry hash
Marketplace policy hash
build contract version
```

只要任意平台不一致，release deploy 不能标记成功。

---

# 31. API / Static 内容职责

Cloudflare API：

- dynamic filtering；
- resolve；
- package metadata；
- advisories；
- publisher；
- MCP。

三平台静态：

- Registry Distribution；
- Search Index；
- Marketplace pages；
- capability discovery；
- version metadata。

静态镜像不得假装提供动态 API。

---

# 32. 测试体系重构

## 32.1 Protocol Tests

使用 fixtures 同时测试：

- Runtime；
- Edge；
- CLI；
- Deep Link；
- MCP。

完成共享 Core 后，Edge/Runtime 不再做“双实现一致性测试”，而改成测试所有入口确实调用共享 Core。

## 32.2 Property Tests

Resolver 必须增加：

- random dependency graph；
- no cycle infinite loop；
- deterministic result；
- unsatisfiable conflict；
- prerelease；
- multi-channel；
- duplicate id cross-type；
- deep graph；
- optional dependency。

## 32.3 Runtime Fault Tests

至少模拟：

- 下载中断；
- digest fail；
- extract fail；
- process kill during commit；
- state CAS conflict；
- disk full；
- stale lock；
- activation crash；
- rollback crash。

## 32.4 E2E Matrix

```text
plugin install/update/remove/rollback
mcp install/update/remove/rollback
skill install/update/remove/rollback
agent install/update/remove/rollback
profile atomic install
bundle atomic install
lock/restore
Deep Link
API plan
MCP plan
```

---

# 33. 性能目标

不只追求功能正确，还要限制常驻和分发成本。

目标：

- CLI 普通 `list/status` 不访问网络；
- Registry unchanged 时 conditional request 近似零数据；
- 安装一个包不下载完整 Registry；
- Resolver 对常规依赖图保持毫秒级至低百毫秒级；
- Marketplace 首页不加载全量 Registry；
- 搜索加载 compact index；
- Registry build deterministic 且可并行；
- Runtime State 写操作为 O(number of installed packages)，不随 catalog 大小增长。

CI 增加性能预算测试，防止回退。

---

# 34. 需要删除 / 合并的旧逻辑类别

以下是升级过程中必须清理的类别。具体文件在实施 PR 中逐项确认后删除。

## 34.1 Runtime

合并 / 删除重复职责：

```text
installer vs artifact-installer
resolver vs registry-cli-resolver vs solver-v2
host-bridge vs client-bridge vs client-host
cli vs package-manager-v2-cli vs type-specific cli
loader vs lifecycle vs startup overlapping state transitions
```

最终只保留明确 Service 边界。

## 34.2 Protocol

删除：

- Edge 私有 SemVer；
- Runtime 私有 SemVer；
- UI 自定义 version sort；
- 页面自定义 Package Type inference；
- legacy parser。

## 34.3 Registry

删除：

- Runtime `plugins[]` 兼容镜像；
- 把 legacy catalog 当安装权威的路径；
- schema 1/2/3 热路径迁移逻辑；
- 多套 Registry package identity。

## 34.4 API

删除：

- `/api/v1`；
- 老 MCP tool naming；
- 旧 install-plan 参数；
- 非结构化 error contract。

## 34.5 Marketplace

删除：

- legacy exact-text i18n walker；
- inline translations；
- 第二套 install command builder；
- 不存在详情页却生成详情 URL 的路径。

## 34.6 CI

删除：

- 重复 gate shell；
- 只验证格式字符串而非行为的 brittle test；
- 已被新 reusable workflow 覆盖的历史 phase workflow。

---

# 35. 文档结构重构

当前 docs 中存在历史 Phase、旧计划和当前事实混排。

最终结构：

```text
docs/
├─ README.md
├─ architecture/
│  ├─ platform.md
│  ├─ runtime.md
│  ├─ registry.md
│  ├─ security.md
│  └─ deployment.md
├─ contracts/
│  ├─ package-protocol-v2.md
│  ├─ manifest-v2.md
│  ├─ registry-v4.md
│  ├─ api-v2.md
│  ├─ mcp-v2.md
│  ├─ runtime-state-v4.md
│  └─ lockfile-v1.md
├─ plan/
│  └─ dsh-go-breaking-architecture-upgrade-master-plan.md
├─ operations/
│  ├─ release.md
│  ├─ deployment.md
│  ├─ rollback.md
│  └─ incident-response.md
└─ history/
   └─ legacy phase documents
```

原则：

- architecture = 当前真实实现；
- contracts = 稳定协议；
- plan = 未完成工作；
- operations = 运行手册；
- history = 仅历史参考，不作为实施依据。

---

# 36. 分阶段实施计划

本计划不采用长期兼容路线，但为了降低一次提交风险，代码仍按可验证阶段落地。

## Phase 0：冻结旧接口

目标：禁止继续扩大旧协议使用面。

执行：

1. 标记所有旧 CLI/API/Deep Link/Registry compatibility path；
2. 禁止新增调用；
3. 建立新协议 contract tests；
4. 建立删除清单；
5. 新功能只允许接入新 Core。

完成标准：

- CI 能检测新增旧接口依赖；
- 新增代码无法引用 legacy parser / legacy Registry projection。

---

## Phase 1：Protocol Core

执行：

1. 建 `packages/protocol-core`；
2. 统一 PackageType / ID / Request / Channel；
3. 统一 SemVer；
4. 统一 errors；
5. CLI / Edge / MCP / Host 全部切换；
6. 删除旧 SemVer / parser。

完成标准：

- Repo 只剩一个 package parser；
- Repo 只剩一个 SemVer implementation；
- 所有入口的 package request fixture 完全一致。

---

## Phase 2：Registry V4 + Distribution V2

执行：

1. 定义 Registry V4 schema；
2. sync pipeline 直接生成 V4；
3. 建 distribution V2；
4. API / Marketplace / Runtime 改读 V4；
5. 删除 V3 runtime dependency；
6. 删除 legacy runtime projections。

完成标准：

- Runtime 安装不再读取 legacy catalog；
- 单包解析无需下载完整 Registry；
- Registry revision/hash 可跨平台验证。

---

## Phase 3：Resolver V2

执行：

1. 合并 resolver / solver / registry resolver；
2. 统一 dependency graph；
3. 加 cycle / conflict / deterministic tests；
4. API `/resolve` 直接复用 Core；
5. Profile / Bundle 改成一次整体 resolve。

完成标准：

- 一个 Resolver；
- Installer 不再做版本选择；
- 相同输入产生相同 resolution hash。

---

## Phase 4：Runtime V4

执行：

1. Runtime State V4；
2. 删除 `plugins[]` mirror；
3. 单一 Store API；
4. Transaction V2；
5. Installer/Artifact Installer 合并职责；
6. Update/Remove/Rollback 统一状态机；
7. Crash recovery。

完成标准：

- 无双写 state；
- 无直接写 registry 文件的旁路；
- fault tests 全绿。

---

## Phase 5：CLI / Deep Link / Host V2

执行：

1. 统一 `dsh package ...`；
2. 删除旧 type-specific CLI；
3. Deep Link V2；
4. Host Bridge 只做边界；
5. 机器 JSON contract。

完成标准：

- 旧 CLI 不存在；
- 旧 Deep Link 不存在；
- Host 无业务 Resolver 逻辑。

---

## Phase 6：API V2 / MCP V2

执行：

1. 实现 `/api/v2`；
2. 新错误 envelope；
3. shared Resolver；
4. 新 MCP tools；
5. 删除 `/api/v1` 与旧 MCP tools；
6. OpenAPI / docs 重写。

完成标准：

- Repo 不含旧 API route；
- MCP 不含旧 tool alias；
- API contract tests 全绿。

---

## Phase 7：Security V2

执行：

1. Trust Policy；
2. real cryptographic signature verification；
3. GitHub OIDC/Sigstore provenance；
4. Publisher ownership；
5. update permission delta；
6. installed revoked package doctor；
7. Trust Center 使用真实 verification state。

完成标准：

- `trusted` 必须密码学可证明；
- digest-only 不再显示 trusted；
- blocked release 无任何安装旁路。

---

## Phase 8：Marketplace + i18n V2

执行：

1. i18n 单一 message contract；
2. 删除 inline dictionaries；
3. 删除 legacy text walker；
4. package view model；
5. canonical install/deeplink formatter；
6. dynamic filtering / search 统一；
7. 详情阈值只来自 policy。

完成标准：

- 5 种语言无混合 UI 文本；
- 动态内容自动更新语言；
- 页面不存在自定义包解析逻辑。

---

## Phase 9：CI / Deploy 收敛

执行：

1. reusable workflows；
2. 删除历史 phase workflow；
3. release freeze gate；
4. 三平台 revision/hash convergence；
5. performance budget；
6. security gate；
7. production smoke。

完成标准：

- 同一逻辑只维护一份 workflow；
- 三平台必须同 revision；
- 任一平台 drift 自动阻断完成状态。

---

## Phase 10：文档与仓库清理

执行：

1. 新 architecture docs；
2. 新 contracts；
3. operations runbook；
4. 旧文档移 history；
5. 删除失效文档；
6. README 与真实命令/API 对齐；
7. package/version/release 文档一致。

完成标准：

- docs 不再把旧接口描述为当前接口；
- README 示例全部可执行；
- 文档 contract 与测试绑定。

---

# 37. 实施顺序与 PR 策略

推荐按以下 PR 链执行：

```text
PR-A  Protocol Core
PR-B  Registry V4 + Distribution V2
PR-C  Resolver V2
PR-D  Runtime State + Transaction V4
PR-E  Canonical CLI + Deep Link + Host
PR-F  API V2 + MCP V2，删除 V1
PR-G  Security / Signature / Trust
PR-H  Marketplace + i18n
PR-I  CI / Deployment convergence
PR-J  Docs / cleanup / final acceptance
```

每个 PR：

- 不要求维持旧接口；
- 但必须保证该 PR 自己在新架构内部逻辑闭环；
- 不允许“旧实现还在跑，新实现只写了一半”；
- 删除旧路径必须与新路径替换同一个 PR 或紧邻 PR；
- main 始终保持可构建、可测试。

---

# 38. 三轮强制审计

每个大阶段完成后至少执行三轮不同视角检查。

## 第一轮：结构审计

检查：

- 重复 parser；
- 重复 SemVer；
- 重复 Resolver；
- 跨层直接依赖；
- orphan module；
- legacy interface；
- import cycle；
- unused compatibility code。

## 第二轮：核心链路审计

逐条走：

```text
discovery → detail → resolve → plan → install → state → activate
search → resolve → install
Deep Link → host → runtime
MCP → plan → user local install
update → dependency → permission delta → transaction
rollback → previous artifact → state
remove → dependency guard → cleanup
```

要求无断链、无重复决策、无孤儿逻辑。

## 第三轮：故障与安全审计

检查：

- network failure；
- corrupted artifact；
- conflicting dependency；
- registry drift；
- concurrent install；
- process crash；
- revoked package；
- malicious archive；
- permission escalation；
- signature failure；
- deployment partial success。

---

# 39. Final Acceptance Gate

最终只有满足以下条件才算本轮升级完成。

## Architecture

- [ ] 一个 Package Protocol Core
- [ ] 一个 SemVer
- [ ] 一个 Resolver
- [ ] 一个 Runtime Store
- [ ] 一个 Transaction Engine
- [ ] 一个 i18n contract
- [ ] 一个 Registry authority

## Legacy Removal

- [ ] 旧 CLI 全部删除
- [ ] 旧 `/api/v1` 全部删除
- [ ] 旧 MCP tool aliases 全部删除
- [ ] 旧 Deep Link 全部删除
- [ ] Runtime legacy state mirror 删除
- [ ] legacy runtime Registry projection 删除
- [ ] inline legacy i18n bridge 删除
- [ ] 旧 resolver/parser/semver 删除

## Runtime

- [ ] Plugin 生命周期全绿
- [ ] MCP 生命周期全绿
- [ ] Skill 生命周期全绿
- [ ] Agent 生命周期全绿
- [ ] Profile / Bundle 原子安装全绿
- [ ] update/rollback/remove 全绿
- [ ] concurrent state tests 全绿
- [ ] fault recovery 全绿

## Security

- [ ] immutable commit verification
- [ ] artifact digest verification
- [ ] cryptographic signer verification
- [ ] provenance verification
- [ ] advisory blocking
- [ ] revoke blocking
- [ ] permission delta confirmation
- [ ] safe extraction

## Marketplace

- [ ] 5-language static UI
- [ ] 5-language dynamic UI
- [ ] Search / filter / load more 无错位
- [ ] >=200 detail policy 一致
- [ ] low-star 无孤儿详情链接
- [ ] canonical CLI / Deep Link

## API/MCP

- [ ] API V2 contract 全绿
- [ ] MCP V2 contract 全绿
- [ ] resolver 共享 Core
- [ ] structured errors
- [ ] ETag / cache

## Deployment

- [ ] Cloudflare green
- [ ] GitHub Pages green
- [ ] EdgeOne green
- [ ] SHA convergence
- [ ] Registry hash convergence
- [ ] Provider hash convergence
- [ ] production smoke green

## Documentation

- [ ] Architecture docs 对齐真实代码
- [ ] Contract docs 对齐测试
- [ ] README 命令全部可执行
- [ ] 无失效文档作为主路径说明

---

# 40. 明确不做的事情

为避免再次扩散，本轮不做：

- 不为旧接口继续写 adapter；
- 不保留两套 CLI；
- 不保留两套 Registry；
- 不保留两套 i18n；
- 不用 Marketplace 替代 Local Runtime；
- 不在 Web 端执行本地 shell；
- 不把 Stars 当安全信任；
- 不修改上游 DeepSeek Harness；
- 不为了兼容旧状态长期维护 schema migration 热路径；
- 不在核心重构完成前继续堆独立 Marketplace 大功能。

---

# 41. 默认技术决策

无需额外确认时，按以下默认值实施：

```text
Package command       = dsh package ...
Package identity      = type:id@version/range
Manifest              = dsh-package.json / manifest_version 2
Remote Registry       = Registry V4
Distribution          = Distribution V2
Local State           = schema_version 4
REST API              = /api/v2
Deep Link             = dsh://package/...
MCP                    = Tools V2
Trust                  = cryptographic verification required for Trusted
API authority          = Cloudflare Pages
Static mirrors         = GitHub Pages + EdgeOne Pages
Languages              = en / zh-CN / ja / ko / es
Detail threshold       = >= 200 Stars
Runtime restart        = explicit / next startup, never forced by remote Web
Compatibility strategy = none for old interfaces
```

---

# 42. 立即执行顺序

从本方案落库后，后续开发严格按以下顺序推进：

```text
1. Protocol Core
2. Registry V4
3. Resolver V2
4. Runtime State / Transaction V4
5. Canonical CLI / Deep Link / Host
6. API V2 / MCP V2
7. Security / Cryptographic Trust
8. Marketplace / i18n Core
9. CI / Deployment convergence
10. Docs cleanup + three-round final acceptance
```

任何新需求如果会重新引入第二套协议、第二套状态或第二套解析器，应直接拒绝该实现方式，改接入 canonical core。

---

# 43. 完成后的最终核心链路

```text
                         ┌───────────────────────┐
                         │   Package Protocol    │
                         │        Core           │
                         └──────────┬────────────┘
                                    │
              ┌─────────────────────┼──────────────────────┐
              │                     │                      │
              ▼                     ▼                      ▼
        Marketplace               API V2                 MCP V2
              │                     │                      │
              └──────────────┬──────┴──────────────┬──────┘
                             │                     │
                             ▼                     ▼
                        Registry V4           Search/Views
                             │
                             ▼
                         Resolver V2
                             │
                             ▼
                       Resolution Plan
                             │
                             ▼
                  Compatibility / Security
                             │
                             ▼
                       Transaction V2
                             │
                             ▼
                         Runtime V4
                             │
                     ┌───────┴────────┐
                     ▼                ▼
                Local State       Activation
                     │                │
                     └───────┬────────┘
                             ▼
                      DeepSeek Harness
```

这条链路中不再存在旧接口旁路、双重 Registry 权威、重复 SemVer、重复 Resolver、重复 Runtime 状态或 Marketplace 直接安装路径。

本方案即作为后续全面升级改造的主执行基线。