# DSH Go 当前架构、详细实现与优化收敛计划 V1

> 审计基线：`main` 当前 Runtime/Registry/API 实现 + PR #136 的 Marketplace UI / i18n / 200 Stars 详情页策略。  
> 核心目标：把项目从“功能不断增加”转为“单一模型、单一权威、单一链路、可验证发布”的 DSH 原生包管理与生态基础设施。

---

## 1. 产品定位

`dsh-go` 不应再被定义为单纯“插件导航站”。当前代码实际上已经由三个产品面组成：

```text
DSH Ecosystem Platform
│
├─ 1. DSH Package Manager / Local Runtime
│    ├─ CLI / Deep Link / Host Bridge
│    ├─ Package Spec Parser
│    ├─ Registry Resolver
│    ├─ Dependency Solver
│    ├─ Compatibility / Permission / Security Preflight
│    ├─ Transaction / Artifact Installer / Rollback
│    ├─ Runtime Registry V3
│    └─ Startup Activation / Bindings
│
├─ 2. DSH Registry Platform / Remote Data Plane
│    ├─ Catalog discovery + sync
│    ├─ Registry V3
│    ├─ Distribution V1
│    ├─ Search Index
│    ├─ Package versions / advisories / publisher evidence
│    └─ API V1 + MCP read-only interface
│
└─ 3. DSH Marketplace / Human Discovery Plane
     ├─ Astro static UI
     ├─ Plugin / MCP / Skill / Agent discovery
     ├─ Search / Trending / Publisher / Trust / Profiles / Bundles
     ├─ Multilingual UI
     └─ Local install plan / dsh:// Deep Link entry
```

最重要的架构边界保持不变：

- **Marketplace 负责发现，不负责本地写入。**
- **Registry V3 是远程包身份、版本、commit 与安全元数据权威。**
- **Local Runtime 是唯一允许安装、更新、回滚、写 Runtime Registry 和激活包的组件。**
- **安装、更新、回滚后不自动重启客户端。**
- **Plugin / MCP / Skill / Agent 共用一套 Package Model、Registry、Resolver、Transaction 和 Lifecycle。**
- **不修改上游 DeepSeek Harness。**

---

## 2. 当前代码分层与目录职责

### 2.1 Catalog / Registry 数据层

主要目录：

```text
catalog/
scripts/sync-v3.mjs
scripts/registry-pipeline-v3.mjs
scripts/registry-distribution.mjs
scripts/build-search-index-v2.mjs
scripts/catalog-distribution.mjs
scripts/copy-assets*.mjs
```

职责：

1. 从 GitHub 与受支持来源同步生态项目；
2. 生成兼容 Catalog；
3. 归一化为 Registry V3；
4. 生成 Distribution V1、delta、搜索索引；
5. 将构建所需数据复制到 `site/public/catalog/`；
6. 为静态站、Cloudflare API、Runtime 客户端提供机器数据。

权威关系：

```text
外部仓库/来源
   ↓ sync / normalize / validate
Catalog discovery data
   ↓ migrate / registry pipeline
Registry V3                ← 安装身份与版本权威
   ├─ Distribution V1      ← 大规模读取/增量分发
   ├─ Search Index V2      ← 搜索/发现投影
   └─ legacy plugins.json  ← 旧客户端兼容出口
```

`plugins.json` 仍然有兼容价值，但不能覆盖 Registry V3 对 type/version/commit/security 的决策。

---

### 2.2 Cloudflare API / MCP 数据服务层

主要目录：

```text
functions/
├─ _lib.ts
├─ _registry.ts
├─ _package-request.ts
├─ _marketplace-v4.ts
├─ _providers.ts
└─ api/v1/
   ├─ index.ts
   ├─ capabilities.ts
   ├─ marketplace.ts
   ├─ ecosystem.ts
   ├─ package-detail.ts
   ├─ install-plan.ts
   ├─ mcp.ts
   ├─ advisories.ts
   ├─ profiles.ts
   ├─ bundles.ts
   ├─ plugins.ts
   ├─ search / stats / meta / health ...
   └─ registry/*
```

职责：

- 对 Registry/Catalog 提供只读 API；
- 搜索、筛选、包详情、版本历史；
- 生成本地安装计划；
- MCP 暴露生态发现工具；
- ETag / Cache-Control / 304；
- 安全策略过滤 revoked / yanked / critical advisory；
- 不执行本地安装。

当前 `_package-request.ts` 已拥有完整的 Edge 侧版本范围与安全解析，但它与 Runtime 的 package parser / SemVer 仍是两套实现，这是后续必须收敛的重点。

---

### 2.3 Marketplace Web 层

主要目录：

```text
site/src/
├─ components/
├─ pages/
├─ layouts/
├─ lib/
├─ i18n/
├─ scripts/
└─ styles/
```

关键链路：

```text
Registry/Catalog
  ↓ Astro build
UnifiedMarketplace
  ↓ 首页 Top / 类型筛选 / Search Index 动态加载
Plugin | MCP | Skill | Agent cards
  ├─ >= detail threshold → 静态详情页
  ├─ < detail threshold  → GitHub source
  ├─ Open in DSH         → dsh://install...
  └─ Copy CLI            → dsh <type> install ...
```

PR #136 后的规则：

- 详情页只为 **>= 200 Stars** 资源生成；
- 低于 200 Stars 仍可发现、搜索、安装，但不能产生孤儿详情 URL；
- 动态筛选后插入的卡片必须重新参与 i18n；
- 五种语言：`en / zh-CN / ja / ko / es`；
- 卡片主体与底部操作栏分离，避免长描述导致布局错位。

本轮架构收敛进一步新增：

```text
config/marketplace-policy.json
```

它成为 Marketplace Stars 门槛和首页限制的单一配置源，避免页面阈值是 200、安装脚本生成器却仍使用 100 这种跨层漂移。

---

### 2.4 Local Runtime / Package Manager

主要目录：

```text
runtime/
├─ package-model.mjs
├─ resolver.mjs
├─ solver-v2.mjs
├─ dependency-guard.mjs
├─ registry-cli-resolver.mjs
├─ compatibility.mjs
├─ preflight.mjs
├─ permissions*.mjs
├─ supply-chain-identity.mjs
├─ supply-chain-verifier.mjs
├─ installer.mjs
├─ artifact-installer.mjs
├─ transaction.mjs
├─ rollback.mjs
├─ registry.mjs
├─ lifecycle.mjs
├─ startup.mjs
├─ loader.mjs
├─ bindings.mjs
├─ host-bridge.mjs
├─ client-bridge.mjs
├─ client-host.mjs
├─ cli*.mjs
└─ v3/**/*.ts
```

当前已经形成完整的本地包生命周期：

```text
CLI / Deep Link / Host
        ↓
parsePackageRequest
        ↓
Registry resolve
        ↓
Dependency graph / SemVer
        ↓
Compatibility + Security + Permission preflight
        ↓
Transaction staging
        ↓
Immutable commit / artifact verification
        ↓
Atomic install / rollback
        ↓
Runtime Registry V3 write
        ↓
pending restart
        ↓
explicit startup activation
        ↓
Binding descriptor / active state
```

#### Runtime Package identity

统一身份：

```text
(type, id)
plugin:example
mcp:example
skill:example
agent:example
```

相同 `id` 可以跨类型存在，不能在相同 `(type,id)` 内重复。

#### Runtime Registry V3

当前 `runtime/registry.mjs` 已实现：

- schema 1/2 → schema 3 迁移；
- `packages[]` 为 canonical；
- `plugins[]` 仅作为兼容镜像；
- temp file + atomic rename；
- cross-process lock；
- stale lock owner 检测；
- generation CAS；
- 冲突重试；
- install lock 元数据 hydration。

因此“增加 Runtime Registry 并发锁”已经不是待办；旧文档中的这一项应更新为已完成。

---

### 2.5 安全与信任层

当前安全机制已经比普通导航站更接近包管理器：

```text
Registry metadata
├─ publisher identity
├─ immutable commit
├─ permissions
├─ compatibility
├─ provenance reference
├─ signature reference
├─ SBOM reference
├─ advisories
├─ yank / revoke
└─ minimum safe version
```

Runtime 当前能：

- 检查 immutable commit；
- 默认拒绝未知/未授权本地权限；
- 阻止 revoked / critical 等不安全版本；
- 安全获取远程 evidence：HTTPS、DNS 解析检查、禁止 localhost/private IP、限制 redirect、限制文件大小；
- 校验 provenance/signature/SBOM evidence 的 SHA-256。

**尚未完成的关键安全能力：真实 cryptographic signer verification。**

现在 signature bundle 只能确认“字节内容与声明 digest 一致”，代码明确仍返回：

```text
cryptographic_signature_verified = false
```

所以后续 Trust Center 不能把“有 signature 字段”与“签名者身份已密码学验证”当成同一个状态。

---

### 2.6 部署与发布层

主要工作流覆盖：

- CI；
- Runtime validation；
- Final Acceptance E2E；
- Sync + watchdog；
- Cloudflare Pages；
- GitHub Pages；
- EdgeOne Pages；
- platform contract；
- package/release；
- Provider Adapter release；
- security audit。

目标拓扑：

```text
                 same source commit
                       │
                build + contract
                       │
        ┌──────────────┼──────────────┐
        ↓              ↓              ↓
Cloudflare Pages   GitHub Pages   EdgeOne Pages
API authority      static copy    static copy
        │              │              │
        └──── exact SHA + Registry/provider hash convergence ────┘
```

当前工作流数量较多，验证逻辑有重复。功能没有问题时也会带来维护成本和“某个 gate 改了但另一个没改”的漂移风险，适合后续用 reusable workflows 收敛。

---

## 3. 端到端核心链路

### 3.1 生态数据链路

```text
GitHub repositories
  ↓
sync-v3
  ↓
Catalog normalization
  ↓
Registry V3 validation
  ↓
Distribution / Search Index / API projections
  ↓
Marketplace + API + MCP + Runtime resolution
```

任何下游都不应重新“猜测” package type/version/security。

### 3.2 Web → 本地安装链路

```text
Marketplace card/detail
  ↓
canonical type + id + version/range + channel
  ↓
CLI command / dsh:// Deep Link
  ↓
Host Bridge validates protocol input
  ↓
local confirmation
  ↓
Runtime package request parser
  ↓
Registry resolver
  ↓
preflight / dependency / permission / trust
  ↓
transaction install
  ↓
Runtime Registry V3
  ↓
restart_required = true
  ↓
manual client restart / startup activate
```

远程网页不能跨过 Host/Runtime 的本地确认边界。

### 3.3 API / MCP → 安装计划链路

```text
API or MCP request
  ↓
Edge package request validation
  ↓
Registry resolve + security filter
  ↓
return install plan
  ↓
client/user explicitly invokes Local Runtime
```

API/MCP 永远只返回计划和元数据，不直接修改本机。

---

## 4. 当前主要架构债务

### A. Package Request / SemVer 仍有重复实现 — P0/P1

Runtime：

```text
runtime/package-model.mjs
runtime/semver.mjs
runtime/resolver.mjs
```

Edge API：

```text
functions/_package-request.ts
```

两边分别维护 ID validation、channel、version range、SemVer、安全过滤。即使现在测试通过，长期仍存在行为漂移风险。

**目标：最终只有一份协议核心。**

迁移顺序：

1. 先建立共享 conformance fixtures；
2. Runtime 与 Edge 对相同用例必须给出相同规范化结果；
3. 再抽 `packages/protocol-core` 或等价 shared module；
4. CLI / Web / MCP / Host / Profile / Bundle 都消费同一协议。

不要直接大爆炸式重写。

---

### B. I18N 当前是多来源体系 — P1

当前存在：

- 全站 `dict.ts`；
- Marketplace 专用 dictionary；
- 页面内 inline dictionary；
- PR #136 的 legacy static text compatibility bridge。

兼容桥能解决当前“切语言后局部不变化”的问题，但不应成为最终长期模型。

目标：

```text
i18n/messages/{en,zh-CN,ja,ko,es}.ts|json
             ↓
     one typed message contract
             ↓
Astro SSR/static text + dynamic browser runtime
```

最终删除 exact-text walker 和页面本地翻译表。

---

### C. Runtime 模块职责过多且存在重叠 — P1

当前 Runtime 已经很强，但模块数量大，命名中仍同时存在：

- installer / artifact-installer；
- resolver / registry-cli-resolver / solver-v2；
- host-bridge / client-bridge / client-host；
- cli / dsh / package-manager-v2-cli；
- loader / startup / lifecycle。

不是立即删除这些模块，而是先明确 canonical ownership：

```text
runtime/core/model          package identity / request / state
runtime/core/resolve        registry + semver + dependency plan
runtime/core/security       compatibility / permission / advisory / trust
runtime/core/transaction    stage / verify / install / rollback
runtime/core/state          Runtime Registry / history / locks
runtime/core/activate       startup / binding
runtime/adapters            CLI / Host / Desktop / MCP / legacy compatibility
```

老模块先做 adapter，再逐步退役，避免一次性破坏兼容链路。

---

### D. Marketplace 策略曾经分散硬编码 — P0，已开始修复

发现的真实漂移：

- UI detail threshold 已改为 200；
- build-time install script generator 仍曾硬编码 100；
- 首页推荐边界另有 100/5000/10000/Top100 常量。

本轮已引入：

```text
config/marketplace-policy.json
```

把发现范围、详情门槛、安装脚本门槛统一配置，并增加回归测试。

这是典型“前端看起来正确，但构建产物逻辑已经分叉”的孤儿逻辑风险，应优先修复。

---

### E. 大 Registry 的前端/客户端读取成本仍可继续降低 — P2

项目已有 Distribution V1 分片，这是正确方向。下一步应让更多读取路径优先使用：

```text
compact index → package shard → local cache → delta
```

而不是任何功能都依赖完整 Registry snapshot。

优先对象：

- Marketplace 全量动态搜索；
- Runtime remote lookup；
- MCP 高频查询；
- package version history。

目标是 Registry 从 1 万、5 万甚至更大规模时，首页和单包安装仍保持近似 O(1)/按需网络成本。

---

### F. Supply-chain “证据完整”还不等于“签名可信” — P2

需要新增真正的 signer verification：

```text
artifact digest
  + provenance digest
  + signature bundle
  + signer identity / issuer
  + configured trust roots/policy
  = cryptographically verified release
```

推荐渐进模型：

- Community：允许无签名，但明确显示未验证；
- Verified Publisher：要求 publisher ownership；
- Trusted Release：要求密码学签名通过；
- Revoked/Critical：始终 fail closed。

---

### G. CI/CD 工作流职责重复 — P2

目标不是减少测试，而是减少相同逻辑的复制：

```text
reusable-quality-gate.yml
reusable-site-build.yml
reusable-runtime-matrix.yml
reusable-deploy-contract.yml
```

上层 CI / PR / Release / Deploy 只组合调用。

这样可以避免 Node 版本、安装命令、typecheck/test/build 顺序在不同 workflow 中漂移。

---

### H. 文档存在实现状态漂移 — P0

典型例子：旧 hardening 文档仍把 Runtime Registry concurrency lock 作为“下一步”，但当前 `runtime/registry.mjs` 已经实现 cross-process lock + generation CAS。

文档应分为：

```text
docs/architecture/current.md       当前真实架构
docs/architecture/contracts.md     稳定不变量
docs/plan/...                      尚未完成规划
docs/history/...                   历史方案
```

“规划文档”不能继续被用户误认为“当前功能说明”。

---

## 5. 优化执行计划

## P0 — 当前立即执行：消除漂移和断链

### P0.1 Marketplace Policy 单一源

状态：**本分支已开始实现。**

- [x] 新增 `config/marketplace-policy.json`；
- [x] UI detail threshold 从配置读取；
- [x] 首页推荐边界从配置读取；
- [x] build-time install script threshold 从配置读取；
- [x] 新增策略一致性测试；
- [ ] CI 完整验证。

### P0.2 PR #136 收口

- 卡片布局；
- 动态 i18n；
- 200 Stars detail policy；
- 低星详情链接不产生 404；
- 五语言动态内容；
- Publisher/详情入口一致。

应先确保 PR #136 CI 全绿后合并，再把本架构分支 rebase/retarget 到 main。

### P0.3 当前架构文档与 README 重定位

- README 不再只写“插件导航站”；
- 明确 Package Manager / Registry / Marketplace 三平面；
- 明确 Runtime compatibility version 与 product/package release version 可以独立；
- 标注历史 plan 与当前 implementation 的区别。

### P0.4 协议漂移回归测试

下一步实现共享 fixture，至少覆盖：

- no-version => `* / latest compatible stable`；
- exact version；
- `^` / `~` / wildcard / comparator；
- plugin/mcp/skill/agent；
- invalid id / traversal；
- stable/beta/nightly/dev；
- ambiguous type；
- revoked/yanked/critical advisory。

在真正抽 shared module 之前，先保证 Runtime 与 Edge 不再悄悄分叉。

---

## P1 — 结构收敛：形成 Canonical Core

### P1.1 Package Protocol Core

建议新增：

```text
packages/protocol-core/
├─ package-request.ts
├─ semver.ts
├─ package-types.ts
├─ error-codes.ts
└─ fixtures/
```

消费方：

```text
Runtime CLI
Host Bridge
Cloudflare API
Marketplace install plan
MCP
Profile / Bundle
Desktop integration
```

所有机器输出错误码固定，不随 UI 语言变化。

### P1.2 I18N Core

- 一个 typed key set；
- 五语言必须 key 完整；
- UI chrome 全部使用 key；
- 用户内容/仓库 README 不强制翻译；
- 动态 DOM 通过统一 renderer/localizer；
- 完成迁移后删除 legacy exact-text compatibility bridge。

### P1.3 Runtime Canonical Services

按 `model → resolve → security → transaction → state → activation` 建立明确依赖方向；旧模块转 adapters。

禁止出现：

```text
UI 直接改 Runtime Registry
Host 自己实现第二套 resolver
Installer 自己猜 package type
Startup 自己重新解释 Registry metadata
```

---

## P2 — 安全、规模与工程治理

1. **Cryptographic release verification**：Sigstore/cosign/TUF 风格 trust policy；
2. **Distribution-first client cache**：delta + shard + content-addressed cache；
3. **Search scalability**：按类型/首字母/token shard 或 Worker 侧索引；
4. **Reusable CI workflows**：统一 quality/build/runtime/deploy gates；
5. **Branch protection**：main 必须要求关键 CI；
6. **Generated-data path policy**：自动 Registry sync 只能改生成数据路径；
7. **Doctor observability**：Registry source、cache age、lock drift、activation failure、protocol registration、trust status。

---

## P3 — 生态能力

在核心稳定后再扩：

- Publisher self-service；
- Verified Publisher / Trusted Release；
- private/multi Registry；
- enterprise policy；
- Profile/Bundle shareable lock；
- package graph visualization；
- usage/quality signals；
- Skill/Agent 专属生命周期增强。

原则：生态功能不能再绕过统一 Package Core。

---

## 6. 建议的最终依赖方向

```text
                     ┌────────────────────┐
                     │  Package Protocol  │
                     │ type/spec/semver   │
                     │ errors/contracts   │
                     └─────────┬──────────┘
                               │
             ┌─────────────────┼─────────────────┐
             ↓                 ↓                 ↓
      Registry Pipeline      API/MCP        Local Runtime
             │                 │                 │
             ↓                 ↓                 ↓
      Distribution/Search   install plan      Resolver
             │                                   ↓
             ↓                              Security Gate
       Marketplace UI                            ↓
             │                               Transaction
             └──── CLI/deep link ────────────────↓
                                             Local State
                                                 ↓
                                             Activation
```

依赖只能向下，不允许：

- Registry 依赖 UI；
- Runtime 依赖 Astro 页面；
- API 依赖 Runtime 本地状态；
- Marketplace 直接写 Runtime；
- legacy adapter 反向成为 canonical core。

---

## 7. 每轮优化的验证标准

任何重构都至少经过三轮检查：

### 第一轮：Contract / Static

- TypeScript；
- ESLint；
- contract tests；
- schema validation；
- i18n key completeness；
- no legacy install syntax；
- no low-star orphan detail link。

### 第二轮：Behavior / E2E

- Search → Detail/Source → Install Plan；
- Web Deep Link → Host parse；
- CLI → Resolver → Preflight → Install；
- update failure → rollback；
- pending restart → startup activation；
- one broken package does not block others；
- offline cache fallback。

### 第三轮：Cross-platform / Deploy

- Linux / Windows / macOS Runtime；
- Cloudflare / GitHub Pages / EdgeOne static contract；
- exact commit SHA；
- Registry hash；
- Provider hash；
- API health / `.well-known`；
- five-locale Marketplace smoke test。

只有三轮均通过才进入 merge/release。

---

## 8. 需要产品负责人确认的问题

当前 **没有阻塞 P0 收敛的问题**；可以按下面默认值直接继续执行。只有这些高影响决策值得确认：

| 决策 | 推荐默认值 | 为什么需要确认 |
|---|---|---|
| 下一阶段最高优先级 | **Package Manager / Runtime 稳定性优先** | 决定 P1 是先收协议核心还是先扩 Marketplace 功能 |
| 兼容承诺 | **至少一个 minor 周期保留旧 CLI / Deep Link / API** | 决定 legacy adapters 的退役速度 |
| Trusted Release 标准 | **密码学签名通过才叫 Trusted；Community 可无签名** | 决定未来安装阻断策略 |
| Private / Multi Registry | **保留接口，暂不优先 UI** | 会显著增加 resolver 和 publisher 复杂度 |
| 部署权威 | **Cloudflare API authority；GitHub/EdgeOne 静态副本** | 决定 deploy gate 与 health semantics |
| 版本体系 | **产品 Release、Runtime compatibility、独立 Marketplace 包允许独立 SemVer** | 避免再次把兼容版本与发布版本混为一谈 |
| 支持语言 | **先稳定当前 5 种，不立即扩展** | 先消除 i18n 多来源再扩语言 |
| 详情页门槛 | **严格 >=200 Stars，无低星例外** | 当前用户需求已经明确，除非主动改变策略 |
| npm 全局分发 | **不是网站发布的前置条件；需要 `npm i -g` 时再作为正式渠道** | 决定 package/release 工作流是否升级为 npm publication |

如果不额外指定，后续优化就按上述默认值推进，不需要在每一小步重复询问。

---

## 9. 本轮完成定义

本轮 Architecture Convergence V1 完成条件：

- Marketplace policy 只有一个配置源；
- PR #136 行为保持不回归；
- 当前真实架构文档落库；
- README 产品定位与真实架构一致；
- Package Parser / SemVer 建立跨 Runtime/Edge conformance gate；
- 全量 CI、Phase E、Final Acceptance 通过；
- 合并后 main 不覆盖更新后的 Registry generated data。

完成这一轮以后，再进入真正的 P1 Canonical Core 抽取，而不是继续在各入口添加第三套逻辑。
