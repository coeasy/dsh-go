# DSH Go 原生包管理与插件商城重构方案

> 状态：三轮改善后的最终重构规划稿  
> 目标：真正把 `dsh-go` 从“插件导航站”升级为“DSH 原生包管理器 + 插件商城 + Registry/Distribution 基础设施”  
> 范围：Plugin / MCP / Skill / Agent、Registry V3、Distribution V1、CLI、Runtime Installer、Host Bridge、Marketplace Web、Tauri 客户端、Publisher、Trust、I18N、三平台 Pages、CI/CD  
> 核心原则：不修改上游 DeepSeek Harness；远程平台只提供发现、元数据与可信分发，本地 Runtime 才能执行安装、写文件、权限确认、激活和回滚；安装成功后绝不自动重启客户端。

---

## 1. 产品定位重构

当前 `dsh-go` 已经拥有 Marketplace、Registry V3、Distribution V1、Runtime Installer、依赖解析、权限预检、回滚、Host Bridge、多平台部署等基础能力，但产品形态仍容易被理解为“插件导航站”。

下一阶段不再围绕“网页展示更多插件”扩张，而是重构为三个清晰层级：

```text
DSH Ecosystem
├── DSH Package Manager        # 本地包管理权威
│   ├── CLI
│   ├── Dependency Solver
│   ├── Transaction Engine
│   ├── Runtime Registry
│   ├── Artifact Store
│   ├── Permission/Security Gate
│   └── Activation/Rollback
│
├── DSH Registry Platform      # 远程机器数据权威
│   ├── Registry V3
│   ├── Distribution V1
│   ├── Package Versions
│   ├── Advisory / Yank
│   ├── Publisher Metadata
│   └── Trust Evidence
│
└── DSH Marketplace            # 人类发现与产品入口
    ├── Web
    ├── API
    ├── MCP
    ├── Search
    ├── Profiles/Bundles
    ├── Publisher Center
    └── Multilingual UI
```

必须明确：

**Marketplace 不是 Installer。Registry 不是 Runtime。Runtime 才是本地安装执行权威。**

---

## 2. 最终用户体验目标

### 2.1 Plugin

```bash
dsh plugin search memory
dsh plugin info example-plugin
dsh plugin install example-plugin
dsh plugin install example-plugin@1.2.0
dsh plugin install example-plugin@^1.2.0
dsh plugin install example-plugin --channel beta
dsh plugin update example-plugin
dsh plugin update --all
dsh plugin outdated
dsh plugin doctor example-plugin
dsh plugin repair example-plugin
dsh plugin rollback example-plugin
dsh plugin disable example-plugin
dsh plugin enable example-plugin
dsh plugin remove example-plugin
dsh plugin history example-plugin
```

### 2.2 MCP / Skill / Agent

```bash
dsh mcp install dsh-go-marketplace
dsh skill install example-skill
dsh agent install example-agent
```

四种类型的命令和生命周期一致，差异只存在于 `type_config`、激活器和运行时绑定器。

### 2.3 通用 Package 命令

```bash
dsh package search <query>
dsh package info <type:id>
dsh package install <type:id>@<range>
dsh package list
dsh package status <type:id>
dsh package lock
dsh package verify <type:id>
dsh package graph <type:id>
dsh package cache status
dsh package cache clean
dsh package registry list
dsh package registry add <name> <url>
dsh package registry remove <name>
```

类型命令是易用入口，`dsh package` 是统一底层入口。

---

# 第一轮改善：从“可安装”升级为“完整本地包管理闭环”

## 3. 第一轮目标

第一轮不重写已有 Runtime Installer，而是修正当前语义不一致、命令不完整、状态不完整的问题，把现有能力真正收敛成包管理器。

### 3.1 第一轮必须修复的现有问题

1. 网站仍可能出现旧的 `dsh plugin add` 文案，必须统一为 `dsh plugin install`。
2. 无版本安装不能默认被“全局固定版本”绑死，应表示 `latest stable`。
3. Web、CLI、MCP 安装计划必须使用同一 Package Spec Parser。
4. Plugin / MCP / Skill / Agent 必须根据 Registry 类型生成不同安装命令。
5. 本地 Registry 状态必须统一，不允许 UI 与 CLI 各自推测安装状态。
6. 安装成功后必须进入 `pending-restart`，不允许自动重启客户端。
7. 更新失败必须恢复旧版本，不能只保留 `.backup` 而没有事务状态。
8. `search/info/outdated` 必须成为正式 CLI 能力，不能要求用户先访问网页。
9. CLI 机器输出必须稳定，不能随着多语言切换改变 JSON 字段、错误码或状态值。
10. 本地安装必须支持完全离线读取已有缓存和 lock 信息。

---

## 4. 统一 Package Spec

建议把所有安装输入统一成一个正式语法：

```text
[type:]id[@version-or-range]
```

示例：

```text
plugin:memory-plus
plugin:coeasy/memory-plus@1.2.0
mcp:dsh-go-marketplace@^0.1
skill:code-review@latest
agent:research-agent@beta
```

解析后统一为：

```ts
interface PackageRequest {
  type: 'plugin' | 'mcp' | 'skill' | 'agent';
  id: string;
  versionRange: string;
  channel: 'stable' | 'beta' | 'nightly' | 'dev';
  registry?: string;
}
```

解析器必须被以下入口共享：

```text
CLI
Web Deep Link
MCP install plan
Tauri Marketplace
Profile
Bundle
Dependency Resolver
```

不能继续各入口分别拼字符串。

---

## 5. 版本选择语义重构

### 当前必须修正的语义

无版本：

```bash
dsh plugin install example-plugin
```

最终语义应为：

```text
latest compatible stable
```

而不是固定某个 `defaults.plugin_version`。

推荐规则：

| 输入 | 语义 |
|---|---|
| 无版本 | latest compatible stable |
| `@1.2.0` | 精确版本 |
| `@^1.2.0` | SemVer 范围 |
| `@~1.2.0` | SemVer 范围 |
| `@latest` | latest stable |
| `--channel beta` | latest compatible beta |
| `--channel nightly` | latest nightly |

Registry 的 `defaults.*_version` 只保留兼容用途，不再承担正常用户的默认安装决策。

---

## 6. CLI 命令树第一轮收口

```text
dsh
├── plugin
│   ├── search
│   ├── info
│   ├── install
│   ├── list
│   ├── status
│   ├── outdated
│   ├── update
│   ├── rollback
│   ├── remove
│   ├── enable
│   ├── disable
│   ├── doctor
│   ├── repair
│   └── history
├── mcp
├── skill
├── agent
├── package
├── profile
├── bundle
├── registry
├── cache
├── doctor
└── runtime
```

所有类型命令最终委托同一 Package Manager Core，避免复制四套安装逻辑。

---

## 7. 统一安装状态机

正式定义：

```text
discovered
  ↓
resolving
  ↓
preflight
  ↓
awaiting-consent
  ↓
downloading
  ↓
verifying
  ↓
staging
  ↓
installing
  ↓
installed
  ↓
pending-restart
  ↓
activating
  ↓
active
```

失败状态：

```text
failed-resolution
failed-download
failed-verification
failed-install
failed-activation
rollback-pending
rolled-back
removed
```

Runtime Registry 记录必须成为状态权威。

Web/Tauri 不能通过“目录是否存在”判断已安装。

---

## 8. Runtime Registry V4 方向

不必立刻破坏 V3，可先通过扩展字段兼容迁移。

建议记录：

```json
{
  "key": "plugin:example-plugin",
  "version": "1.2.0",
  "channel": "stable",
  "state": "pending-restart",
  "enabled": true,
  "activated": false,
  "source_registry": "official",
  "source_commit": "...",
  "artifact_digest": "sha256-...",
  "install_transaction": "txn-...",
  "installed_at": "...",
  "activated_at": null,
  "restart_required": true,
  "dependencies": [],
  "dependents": [],
  "health": {},
  "rollback": {},
  "history": []
}
```

---

## 9. 第一轮 Marketplace 改造

Marketplace 首页和详情页不再只是“项目卡片”。

每个 package 必须展示：

- package type；
- install command；
- latest stable；
- available channels；
- compatible runtime/client；
- permissions；
- dependencies；
- publisher；
- trust level；
- artifact type；
- security evidence；
- latest update；
- install status（仅本地客户端可知）；
- `Copy command`；
- `Install with DSH`；
- `Preview install`。

Web 安装链：

```text
Marketplace
  ↓
dsh://install?package=plugin:example-plugin
  ↓
DSH Host
  ↓
parse request
  ↓
local preflight
  ↓
permission dialog
  ↓
Package Manager Core
```

远程网页永远不能绕过本地确认。

---

## 10. 第一轮多语言收口

第一轮支持：

```text
en
zh-CN
ja
ko
es
```

但必须坚持：

### 永不翻译

- package id；
- type；
- version；
- channel；
- commit；
- digest；
- capability id；
- permission id；
- error code；
- CLI subcommand；
- API field。

### 可翻译

- package display name；
- description；
- category label；
- permission explanation；
- CLI human message；
- Web/Tauri UI；
- documentation。

CLI 增加：

```bash
dsh --lang zh-CN plugin info example-plugin
dsh --json plugin info example-plugin
```

`--json` 永远输出语言无关稳定 schema。

---

## 11. 第一轮验收标准

第一轮完成必须满足：

```text
search -> info -> preflight -> install -> registry -> restart -> activate -> status
```

完整贯通。

同时：

- Web 与 CLI 安装命令 100% 同源；
- 无 `plugin add` 历史文案；
- 四种 package 类型 E2E；
- 安装失败不会污染 active 状态；
- update 失败可以回滚；
- 所有 install/update/remove 不自动重启客户端；
- JSON CLI contract 有测试；
- 多语言缺词 CI fail；
- Windows/Linux/macOS 安装路径测试。

---

# 第二轮改善：升级为生产级 Package Manager Core

## 12. 第二轮目标

第二轮解决第一轮仍然存在的包管理器深层问题：

```text
重复下载
非原子更新
缓存不可复用
多 Registry 冲突
依赖求解不够稳定
离线能力有限
供应链信任不完整
版本复现不足
```

目标是形成真正稳定的本地 Package Manager Core。

---

## 13. Content Addressed Store

不建议每次安装直接把 artifact 下载到 package 目录。

增加：

```text
~/.dsh/store/sha256/<digest>/
~/.dsh/cache/registry/
~/.dsh/cache/artifacts/
```

安装流程：

```text
fetch artifact
  ↓
verify digest
  ↓
CAS store
  ↓
staging
  ↓
materialize package
```

优点：

- 多 package 共用 artifact；
- rollback 不必重新下载；
- offline reinstall；
- digest 天然去重；
- transaction 失败不会污染最终目录。

---

## 14. Package Lock

增加用户环境级锁定文件：

```text
~/.dsh/dsh.lock
```

记录：

```json
{
  "lock_version": 1,
  "packages": {
    "plugin:memory": {
      "version": "1.4.2",
      "commit": "...",
      "digest": "sha256-...",
      "registry": "official",
      "dependencies": []
    }
  }
}
```

目标：

```bash
dsh package lock
dsh package restore
dsh package verify-lock
```

最终实现环境可复现。

---

## 15. Transaction Engine

所有会修改本地状态的操作必须进入事务：

```text
install
update
rollback
remove
enable
disable
profile apply
bundle install
```

事务阶段：

```text
prepare
resolve
verify
stage
commit
activate-pending
finalize
```

事务日志：

```text
~/.dsh/transactions/<txn-id>.json
```

异常断电/客户端崩溃后：

```bash
dsh transaction recover
```

恢复到：

- commit 前：删除 staging；
- commit 后 activation 前：保留 pending-restart；
- update 中断：恢复 previous version。

---

## 16. Dependency Solver V2

当前 DAG 已有基础，第二轮要补：

- SemVer constraint aggregation；
- optional dependency；
- peer capability；
- virtual provide；
- conflicts；
- replaces；
- channel compatibility；
- runtime capability constraint；
- platform constraint；
- yanked exclusion；
- security advisory exclusion。

输出必须可解释：

```bash
dsh package graph example-plugin
dsh package explain example-plugin
```

例如：

```text
plugin:a@1.4.0 selected because:
- root requires ^1.3
- plugin:b requires >=1.4 <2
- stable channel only
- 1.5.0 rejected: client >=0.3 required
```

包管理器不能只报 `not found`。

---

## 17. Multi-Registry

正式引入 registry 配置：

```text
~/.dsh/registries.json
```

示例：

```json
{
  "registries": [
    { "name": "official", "url": "...", "priority": 100, "trusted": true },
    { "name": "company", "url": "...", "priority": 200, "trusted": true },
    { "name": "community", "url": "...", "priority": 50, "trusted": false }
  ]
}
```

CLI：

```bash
dsh registry list
dsh registry add
dsh registry remove
dsh registry refresh
dsh registry doctor
```

冲突规则必须明确：

1. 显式 `--registry` 最高；
2. lock 中已有来源优先；
3. trusted registry 优先；
4. priority；
5. 同名不同 publisher identity 必须 fail closed。

---

## 18. 三平台镜像与 Registry Federation

当前已经有 Cloudflare Pages、GitHub Pages、EdgeOne Pages。

第二轮可以把它们升级为 Registry Mirror，但不能形成三个相互独立的 Registry。

正确结构：

```text
Canonical Registry Build
        ↓
content_hash
        ↓
Signed Registry Snapshot
        ↓
 ┌───────────────┬───────────────┬───────────────┐
Cloudflare      GitHub Pages     EdgeOne
```

客户端选择镜像时必须比较：

- snapshot id；
- registry_version；
- content_hash；
- signature；
- generated_at；
- monotonic revision。

任何镜像 hash 不一致时必须被排除。

---

## 19. 安全模型第二轮

### Trust Level

```text
official
verified
community
unverified
blocked
```

### 强制检查

```text
immutable commit
artifact sha256
publisher ownership
permission manifest
compatibility
security advisory
yanked status
```

### Enhanced Evidence

```text
Sigstore
SLSA provenance
SBOM
release signature
publisher identity
```

### 高风险权限

以下必须显式确认：

```text
shell
process.spawn
filesystem.write
secrets.read
network.unrestricted
```

危险权限升级时，即使是正常 update 也必须重新确认。

---

## 20. Advisory / Yank / Revoke

包管理平台必须支持“已发布版本后续被发现有问题”。

Registry 增加：

```text
yanked
advisories
revoked
minimum_safe_version
```

行为：

- yanked：不再给新安装选择，但已安装用户可继续查看；
- revoked：默认禁止运行，需要安全说明；
- advisory：doctor/outdated 显示；
- critical advisory：客户端明确告警，但仍不允许远程平台直接卸载本地包。

---

## 21. 第二轮离线能力

```bash
dsh package export example-plugin --output example.dshpkg
dsh package install ./example.dshpkg
dsh package restore --offline
dsh registry refresh --offline
```

`.dshpkg` 包应包含：

- manifest；
- artifact；
- digest；
- publisher identity；
- security evidence；
- dependency metadata。

离线包不能绕过安全 Gate。

---

## 22. 第二轮验收标准

- install/update/remove 全事务化；
- crash recovery 测试；
- CAS 去重测试；
- lock restore 可复现；
- multi-registry identity conflict fail closed；
- mirror hash convergence；
- security advisory/yank E2E；
- dependency explanation 可读；
- offline package 安装与恢复；
- permission escalation update 必须再次授权。

---

# 第三轮改善：升级为完整 DSH 包生态与插件商城平台

## 23. 第三轮目标

第三轮不再仅关注“本地能不能装”，而是建设：

```text
Publisher -> Registry -> Marketplace -> Package Manager -> Runtime -> Feedback
```

完整生态。

---

## 24. Publisher Workflow

插件作者标准流程：

```bash
dsh package init
dsh package validate
dsh package audit
dsh package sbom
dsh package publish-check
dsh package pack
dsh package publish
```

但 `publish` 初期不必允许任意客户端直接写中央 Registry。

推荐：

```text
package manifest
  ↓
GitHub Release
  ↓
Marketplace Submission / GitHub PR
  ↓
Registry Validator
  ↓
Publisher Ownership
  ↓
Artifact Verification
  ↓
Security Gate
  ↓
Registry Merge
```

后续再开放 authenticated Publisher API。

---

## 25. Package Manifest V2

保留 V1 兼容，但规划 V2：

```json
{
  "manifest_version": "2.0.0",
  "id": "example-plugin",
  "type": "plugin",
  "version": "1.2.0",
  "display": {
    "default_locale": "en",
    "name": "Example Plugin",
    "summary": "..."
  },
  "runtime": {},
  "dependencies": [],
  "permissions": [],
  "compatibility": {},
  "publisher": {},
  "artifact": {},
  "security": {},
  "localization": {
    "overlays": ["zh-CN", "ja", "ko", "es"]
  }
}
```

身份字段永远语言无关，本地化内容进入 overlay。

---

## 26. Localization Overlay

建议路径：

```text
locales/
├── en.json
├── zh-CN.json
├── ja.json
├── ko.json
└── es.json
```

只允许覆盖：

- name；
- summary；
- description；
- category label；
- permission explanation；
- documentation links。

不允许覆盖：

- id；
- version；
- type；
- dependencies；
- permissions ID；
- artifact；
- publisher identity；
- security evidence。

这样 Registry hash 与安装决策不会受语言影响。

---

## 27. Marketplace Search Platform

Web 搜索和 CLI 搜索都不应加载完整 Registry。

建立：

```text
Search Index
├── package id
├── type
├── publisher
├── tags
├── category
├── localized text tokens
├── trust
├── stars/trend
├── updated_at
└── latest stable
```

搜索结果只用于发现。

安装时必须再次从 Registry authoritative record 解析，不允许直接信任 Search Index。

---

## 28. Marketplace Ranking

推荐分层：

```text
Freshness
Quality
Trust
Popularity
Compatibility
User Intent
```

首页近期更新继续优先，但不能允许：

- 刚更新的恶意包压过 Verified；
- yanked 包进入推荐；
- incompatible 包成为默认一键安装；
- aggregator 仓库污染 package 排名。

推荐逻辑：

```text
eligibility gate
  ↓
trust gate
  ↓
freshness bucket
  ↓
quality score
  ↓
popularity/trend
```

搜索排序和首页推荐必须分离，不能共享一个模糊 score。

---

## 29. Marketplace 页面结构

### 首页

- Recently Updated；
- Verified；
- Popular；
- New；
- Plugin / MCP / Skill / Agent 分类；
- Profiles / Bundles；
- Trust Center。

### Package Detail

- localized display；
- package identity；
- type；
- latest stable；
- versions；
- channels；
- install command；
- compatibility；
- permissions；
- dependencies；
- dependents；
- conflicts；
- trust；
- advisories；
- SBOM/provenance；
- publisher；
- changelog；
- install deep link。

### Publisher

- ownership；
- packages；
- verification；
- releases；
- security history。

---

## 30. Tauri 客户端 Marketplace

未来 `dsh-go-marketplace-plugin` 可以成为 UI 插件，但不复制 Installer。

结构：

```text
Tauri Marketplace UI
  ↓
Marketplace API
  ↓ discovery
Package Manager IPC
  ↓ local plan
Permission Dialog
  ↓
Runtime Installer
```

客户端功能：

- 搜索；
- 安装；
- 更新；
- 已安装；
- 待重启；
- 安全告警；
- rollback；
- logs；
- doctor。

安装成功：

```text
Installed
Restart required
[Later] [Restart DSH]
```

不允许 Installer 自己关闭/重启 Host。

---

## 31. Profile 与 Bundle 升级

Profile/Bundle 不再只是配置文件批量安装，而要使用 lock + transaction。

```bash
dsh profile apply quant-dev
dsh bundle install ai-coding-stack
```

执行：

```text
resolve all packages
  ↓
conflict analysis
  ↓
permission union
  ↓
user approval
  ↓
single transaction
  ↓
atomic commit
```

任一必选 package 失败，整个事务回滚。

---

## 32. Private Registry / Enterprise

长期可以支持：

```bash
dsh registry add corp https://registry.example.com/dsh
```

企业能力：

- private packages；
- organization allowlist；
- internal publisher；
- policy enforcement；
- blocked permissions；
- internal mirror；
- lockfile enforcement；
- air-gapped export。

开源官方 Registry 和私有 Registry 使用相同协议。

---

## 33. API 重构方向

保持 `/api/v1` 兼容，同时明确三类 API：

```text
Discovery API
Registry API
Marketplace Presentation API
```

### Discovery

```text
/api/v1/search
/api/v1/packages
/api/v1/categories
```

### Registry

```text
/api/v1/registry
/api/v1/registry/delta
/api/v1/registry/packages/{type}/{id}/versions
/api/v1/advisories
```

### Presentation

```text
/api/v1/marketplace/home
/api/v1/publishers/{id}
/api/v1/profiles
/api/v1/bundles
```

安装执行 API 永远不存在于远程平台。

可以存在：

```text
/api/v1/install-plan
```

但只返回计划，不写本地。

---

## 34. MCP 定位

当前 `dsh-go-marketplace` 保持 MCP：

```bash
dsh mcp install dsh-go-marketplace
```

职责：

- search packages；
- package info；
- categories；
- versions；
- install plan；
- trust/advisory 查询。

MCP 可以生成推荐命令，但不能直接绕过 Host confirmation 执行本地安装。

如果需要 Marketplace UI，另建：

```text
dsh-go-marketplace-plugin
```

不能把 MCP 强行改类型。

---

## 35. 三平台生产架构

推荐：

```text
GitHub
  ↓ Sync
Canonical Registry Build
  ↓ Validate
Registry Snapshot
  ↓
Cloudflare Pages   # API + canonical web
GitHub Pages       # static mirror
EdgeOne Pages      # static mirror / regional
```

生产 Gate：

```text
exact git SHA
registry content hash
distribution hash
search index hash
localization bundle hash
provider adapter hash
well-known contract
```

三平台必须收敛到同一 snapshot revision。

---

## 36. CI/CD Gate

新增/强化：

```text
Package Schema Gate
Registry Integrity Gate
Dependency Solver Tests
Transaction Recovery Tests
Install E2E Matrix
Windows/macOS/Linux Paths
Permission Escalation Test
Supply-chain Evidence Test
Mirror Convergence Test
Localization Coverage Gate
Pseudo-locale Layout Test
CLI JSON Contract Test
Deep-link Security Test
Backward Compatibility Gate
```

发布新 Runtime 以前，不能只验证 build。

---

## 37. 错误模型

CLI/API/Runtime 使用稳定 error code：

```text
DSH_PACKAGE_NOT_FOUND
DSH_VERSION_NOT_FOUND
DSH_DEPENDENCY_CONFLICT
DSH_DEPENDENCY_CYCLE
DSH_PERMISSION_CONSENT_REQUIRED
DSH_PACKAGE_YANKED
DSH_PACKAGE_REVOKED
DSH_INTEGRITY_MISMATCH
DSH_SIGNATURE_INVALID
DSH_COMPATIBILITY_FAILED
DSH_TRANSACTION_FAILED
DSH_TRANSACTION_RECOVERY_REQUIRED
DSH_REGISTRY_UNAVAILABLE
DSH_REGISTRY_IDENTITY_CONFLICT
DSH_ACTIVATION_FAILED
```

用户看到的 message 可本地化，但 code 永远不变。

---

## 38. 目录结构建议

```text
runtime/
├── package-manager/
│   ├── spec.mjs
│   ├── resolver.mjs
│   ├── solver.mjs
│   ├── transaction.mjs
│   ├── store.mjs
│   ├── lock.mjs
│   ├── registry-client.mjs
│   ├── installer.mjs
│   ├── verifier.mjs
│   ├── lifecycle.mjs
│   └── errors.mjs
│
├── activators/
│   ├── plugin.mjs
│   ├── mcp.mjs
│   ├── skill.mjs
│   └── agent.mjs
│
├── security/
└── compatibility/

site/src/
├── marketplace/
├── i18n/
├── search/
└── package-ui/

catalog/
├── registry-v3.json
├── distribution-v1/
├── search-index/
├── advisories/
├── localization/
└── snapshots/
```

目标是逐步迁移，不要求一次性重命名所有现有文件。

---

# 三轮方案复盘与继续修正

## 39. 第一轮方案暴露的问题

第一轮如果只实现 CLI search/info/install，仍然只能算“更好用的 Installer”。

因此第二轮增加：

- CAS；
- lock；
- transaction；
- multi-registry；
- mirror snapshot；
- advisory；
- offline。

这些能力决定它是否真正是 Package Manager。

---

## 40. 第二轮方案暴露的问题

第二轮如果只强化本地内核，仍然缺少生态闭环。

因此第三轮增加：

- Publisher Workflow；
- Manifest V2；
- Localization Overlay；
- Marketplace Search；
- Trust Center；
- Publisher 页面；
- Profile/Bundle atomic install；
- Private Registry；
- Tauri Marketplace；
- 社区治理。

这样才能从 Package Manager 上升为 Ecosystem Platform。

---

## 41. 第三轮最终修正

最终必须避免以下反模式：

### 反模式 1：Marketplace 直接安装

禁止。

正确：

```text
Marketplace -> Deep Link -> Local Runtime -> Approval -> Install
```

### 反模式 2：Registry 直接混入翻译字段作为身份

禁止。

正确：

```text
identity registry + localization overlay
```

### 反模式 3：Web 排名分数复用为安装信任分数

禁止。

Popularity 与 Trust 必须独立。

### 反模式 4：四种 Package 各自复制 Installer

禁止。

必须统一 Package Manager Core + Type Activator。

### 反模式 5：只靠 Git tag 表示可信版本

禁止。

必须绑定 immutable commit + digest + publisher identity。

### 反模式 6：安装成功自动重启客户端

禁止。

只进入 pending restart。

### 反模式 7：多 Registry 同名包静默覆盖

禁止。

Publisher identity 不一致必须 fail closed。

### 反模式 8：更新失败只报错，不恢复

禁止。

更新属于事务，必须 rollback。

---

# 实施路线图

## 42. Phase A：Package Manager UX Closure

优先级 P0。

实施：

1. 修 `plugin add` 历史文案；
2. latest stable 默认版本语义；
3. 统一 Package Spec Parser；
4. CLI search/info/outdated；
5. Web 安装命令生成器；
6. typed install command；
7. install state normalization；
8. pending restart UI；
9. JSON CLI contract；
10. 多语言 locale 基础。

完成标志：用户完全可以不打开 GitHub，通过 DSH CLI 搜索并安装市场中的 package。

---

## 43. Phase B：Package Manager Core V2

优先级 P0/P1。

实施：

1. transaction journal；
2. content-addressed artifact store；
3. lockfile；
4. resolver explanation；
5. dependency solver V2；
6. multi-registry；
7. offline install；
8. advisory/yank；
9. permission escalation；
10. crash recovery。

完成标志：安装、更新、恢复、复现达到生产级。

---

## 44. Phase C：Marketplace Platform V4

优先级 P1。

实施：

1. authoritative Search Index；
2. package detail V2；
3. versions/advisory UI；
4. publisher page；
5. trust center；
6. localization overlay；
7. locale routes/SEO；
8. profiles/bundles UI；
9. Deep Link UX；
10. Marketplace MCP 增强。

完成标志：Marketplace 成为真正的 Package Discovery Frontend，而不是 GitHub 列表页。

---

## 45. Phase D：Publisher Ecosystem

优先级 P1/P2。

实施：

1. manifest v2；
2. publisher ownership；
3. release validator；
4. SBOM；
5. provenance；
6. signature；
7. submission workflow；
8. yank/revoke；
9. security advisory；
10. community translation。

---

## 46. Phase E：Desktop + Enterprise

优先级 P2。

实施：

1. `dsh-go-marketplace-plugin`；
2. Tauri IPC Package Manager；
3. installed/update/restart center；
4. private registry；
5. enterprise policy；
6. air-gap package export；
7. organization bundle/profile。

---

# 测试与验收矩阵

## 47. 核心 E2E

每种 package 类型：

```text
search
info
preflight
install
verify
list
status
restart
activate
doctor
update
rollback
disable
enable
remove
```

必须在：

```text
Windows x64
Linux x64
macOS x64
macOS arm64
```

至少形成自动测试或可重复 smoke test。

---

## 48. 故障测试

主动制造：

- registry 503；
- mirror hash mismatch；
- artifact digest mismatch；
- broken archive；
- git commit missing；
- dependency cycle；
- conflicting dependency；
- permission escalation；
- disk full；
- process killed during install；
- process killed during update；
- activation failure；
- revoked package；
- stale cache；
- duplicate package across registries。

所有故障必须有明确恢复路径。

---

# 最终成功标准

## 49. 用户视角

一个新用户只需要安装 DSH，然后：

```bash
dsh plugin search github
dsh plugin install github-tools
```

即可完成：

```text
发现
解析
权限提示
依赖解析
安全校验
下载
安装
注册
等待重启
激活
健康检查
```

无需：

- 手动 clone；
- 找安装目录；
- 修改 JSON；
- 猜依赖；
- 手工校验版本。

---

## 50. 开发者视角

开发者：

```bash
dsh package init
dsh package validate
dsh package publish-check
```

可以得到一个符合 Registry/Marketplace/Runtime 共同契约的 package。

---

## 51. 平台视角

最终 `dsh-go` 不再是：

```text
GitHub 插件导航站
```

而应成为：

```text
DSH Native Package Ecosystem
├── Package Manager
├── Registry
├── Distribution
├── Marketplace
├── Publisher Platform
├── Trust/Security Center
├── Profiles/Bundles
├── MCP Discovery
├── Desktop Integration
└── Multilingual Ecosystem
```

其中最重要的架构原则始终保持：

> **远程 Marketplace 决定“发现什么”，Registry 决定“可解析什么”，本地 Package Manager 决定“实际安装什么”，Runtime 决定“最终激活什么”。**

只要四个职责不混淆，`dsh-go` 就可以在不修改上游 DeepSeek Harness 的前提下长期扩展为真正独立、可复用、可安装、可治理的 DSH 包生态基础设施。
