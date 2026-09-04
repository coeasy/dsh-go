# DSH Go V4 架构加固与 Runtime Supervisor 全面优化方案

> 状态：实施基线。本文建立在 `docs/architecture/dsh-go-v4-final-architecture.md` 之上，不升级公共 Protocol/Registry/Runtime State 版本，不恢复任何旧接口兼容层。

## 1. 目标

本轮不再改变已经确定的外部契约：

- Package Protocol V2；
- Package Manifest V2；
- Registry V4；
- Resolver V2；
- Runtime State V4；
- API V2 / MCP Tools V2；
- Marketplace V2。

本轮只完成内部架构加固，把当前“功能完整的包管理器”收敛成长期可演进的本地插件运行平台。

核心目标：

1. Local Runtime 成为唯一写入权威与唯一并发协调中心；
2. 安全、权限、信任和企业策略收敛到统一 Policy Engine；
3. 所有已验证包内容进入 Content-Addressable Artifact Store；
4. 启动激活具备 candidate / active / last-known-good 三代恢复能力；
5. Plugin / MCP / Skill / Agent 共用包模型，但使用独立 Runtime Adapter；
6. Discovery 与 Registry Authority 之间引入 Candidate / Quarantine 边界；
7. Secret 与普通配置彻底分离；
8. 所有重要本地写操作产生稳定、可审计、可关联的结构化事件；
9. Environment Lock 锁定安装内容与信任快照；
10. CI 增加 Architecture Conformance Gate，防止重复 Parser、Resolver、直接状态写入和跨层依赖重新出现。

## 2. 最终九层架构

```text
L1  Package Protocol / Manifest
        ↓
L2  Discovery / Candidate / Registry
        ↓
L3  Trust / Advisory / Policy
        ↓
L4  Resolver / Resolution Plan
        ↓
L5  Artifact CAS / Transaction
        ↓
L6  Runtime Supervisor / Runtime State
        ↓
L7  Runtime Adapters / Activation / Health
        ↓
L8  CLI / Local Host / Deep Link / Desktop
        ↓
L9  Edge API / MCP / Marketplace / Distribution
```

横向基础设施：

```text
Observability / Audit
Secrets / Effective Config
Environment Lock / Recovery
```

### 2.1 强制依赖方向

- `protocol-core` 不依赖 Registry、Runtime 或网络；
- `registry-core` 只依赖 Protocol；
- `policy-core` 只消费规范化 Package / Publisher / Environment 输入；
- `resolver` 可以调用 `policy-core` 做只读可安装性判断，但不得访问本地文件系统；
- Runtime 可以依赖 Protocol / Resolver / Policy / CAS；
- CLI / Local Host / Deep Link 不得直接修改 Runtime State；
- Edge API / MCP / Marketplace 永远不得写本地状态；
- Site 不得 import `runtime/*`。

## 3. Runtime Supervisor

### 3.1 角色

新增 `runtime/supervisor.mjs`，成为本地所有 mutation 的唯一入口。

```text
CLI ─────────┐
Desktop ─────┤
Deep Link ───┼── Local IPC/API ──> Runtime Supervisor
Local Host ──┘                       │
                                     ├─ Package Service
                                     ├─ Policy Engine
                                     ├─ Transaction Engine
                                     ├─ Artifact Store
                                     ├─ Runtime State V4
                                     ├─ Activation Manager
                                     └─ Audit Log
```

Supervisor 负责：

- process-level mutation mutex；
- request / operation id；
- explicit approval enforcement；
- install / update / remove / rollback / enable / disable / restore / activate 的统一调度；
- transaction recovery；
- structured audit event；
- 状态冲突重试；
- mutation 完成后永不自动重启宿主。

底层 Runtime State V4 的 file lock + generation CAS 继续保留，作为进程崩溃与异常并发的最终保护。

## 4. Policy Engine

新增 `packages/policy-core`。

### 4.1 输入

```text
PolicyInput
├─ operation
├─ package
├─ publisher
├─ permissions
├─ capabilities
├─ advisories
├─ security/signature evidence
├─ selected registry
├─ environment
└─ approved
```

### 4.2 输出

```text
PolicyDecision
├─ decision: allow | deny | require-confirmation
├─ reasons[]
├─ warnings[]
├─ trust_level
├─ required_permissions[]
└─ evaluated_at
```

### 4.3 规则

至少覆盖：

- revoked → deny；
- critical advisory → deny；
- yanked new install → deny；
- compatibility mismatch → deny；
- unapproved privileged permission → require-confirmation / deny；
- untrusted custom registry → require-confirmation 或由 enterprise policy 阻断；
- `Trusted` 只有 verified publisher ownership + cryptographic signature verified 才成立；
- stars 永远不进入安全判定。

Resolver、Installer、Activation 与 Local Host 必须复用同一决策函数。

## 5. Content-Addressable Artifact Store

统一存储：

```text
~/.dsh/store/sha256/<digest>/
```

新增 Store API：

- `putDirectory()`；
- `putFile()`；
- `verify()`；
- `materialize()`；
- `has()`；
- `gc()`。

### 5.1 安装链

```text
Registry release
  ↓
Download / immutable source checkout
  ↓
Verify digest + signature + provenance
  ↓
CAS ingest
  ↓
Transaction staging from CAS
  ↓
Atomic target switch
  ↓
Runtime State publish
```

Runtime 安装路径不再是供应链事实来源，`.dsh-install.json` 和 Runtime State 必须记录 `content_digest`。

Environment Lock 直接引用相同 CAS digest，不再制造另一套内容存储语义。

## 6. Trust Root 与 Publisher Identity

新增本地 Trust Store：

```text
~/.dsh/trust/trust-root.json
```

记录：

- publisher ownership evidence；
- public key / identity；
- key rotation；
- key revocation；
- accepted issuer / subject policy；
- trust snapshot revision。

Release Trust Snapshot：

```text
publisher_verified
signature_verified
provenance_verified
signer_identity
key_fingerprint
trust_root_revision
verified_at
```

Environment Lock 必须保存该 snapshot，确保历史环境可解释、可审计。

## 7. Activation Manager 与 Last-Known-Good

安装事务与启动激活事务必须分离。

```text
installed/pending-activation
          ↓
      preflight
          ↓
 candidate_generation
          ↓
       activate
          ↓
      health check
       ↙       ↘
     PASS      FAIL
      ↓         ↓
 active       rollback LKG
```

Runtime State 顶层新增可选 activation metadata：

- `active_generation`；
- `candidate_generation`；
- `last_known_good_generation`；
- `last_activation_at`。

Package record 记录：

- activation attempt；
- adapter；
- health；
- failure reason。

启动失败不能形成无限重试循环：同一 package version + content digest 达到失败阈值后进入 `failed`，只有显式操作或新版本才再次激活。

## 8. Runtime Adapter ABI

新增：

```text
runtime/adapters/
├─ index.mjs
├─ plugin.mjs
├─ mcp.mjs
├─ skill.mjs
└─ agent.mjs
```

统一接口：

```text
validate(context)
prepare(context)
bind(context)
activate(context)
health(context)
deactivate(context)
cleanup(context)
```

Package Model 保持统一，执行语义按 package type 分离，禁止继续向通用 loader 增加大规模 `if (type === ...)` 分支。

## 9. Discovery Candidate / Quarantine

Registry Builder 之前增加明确 staging：

```text
External Sources
  ↓
Collector
  ↓
Candidate Store
  ↓
Normalize
  ↓
Manifest V2 validation
  ↓
Immutable commit resolution
  ↓
Security / Trust evaluation
  ↓
Quarantine decision
  ↓
Registry V4 Builder
```

Candidate 数据不是 Registry Authority，不被 Runtime 直接消费。

Rejected / Quarantined candidate 必须带 machine-readable reason。

## 10. Config 与 Secret

### 10.1 Config precedence

```text
package defaults
  ↓
user config
  ↓
workspace config
  ↓
package-instance config
  ↓
runtime effective config
```

### 10.2 Secret boundary

Secret value 永远不能出现在：

- Runtime State；
- Registry；
- Environment Lock；
- Audit log；
- CLI JSON output；
- HTTP GET response。

状态只保存：

```text
secret_ref: provider/openai/api-key
```

Secret backend 优先使用 OS credential store；测试环境允许 file backend，但必须显式 opt-in 且文件权限为 owner-only。

## 11. Observability / Audit Contract

新增 append-only JSONL event stream：

```text
~/.dsh/logs/audit-v1.jsonl
```

事件必须包含：

- timestamp；
- event_version；
- request_id；
- operation_id / transaction_id；
- package coordinate；
- registry_revision；
- resolution_hash；
- policy decision；
- generation_before / generation_after；
- result；
- duration_ms；
- error_code；
- recoverable / recovery_required。

日志必须执行 secret/redaction sanitizer。

## 12. Environment Lock 加固

Environment Lock V2 保持 schema version 不变，但增加可选字段：

- `content_digest`；
- `trust_snapshot`；
- `policy_snapshot`；
- `adapter`；
- `registry_revision`；
- `resolution_hash`。

Restore 前执行：

1. lock hash 验证；
2. CAS 验证；
3. trust snapshot / revocation re-check；
4. Policy Engine；
5. explicit approval；
6. transactional materialize；
7. single Runtime State CAS publish；
8. pending activation。

## 13. Architecture Conformance Gate

新增 `scripts/check-architecture.mjs`，CI 必须阻断：

- Site import Runtime；
- Edge functions import installer / filesystem mutation；
- Resolver import Runtime / fs / network；
- CLI/Host 直接 import Runtime Registry mutation API；
- duplicate SemVer parser；
- duplicate package coordinate parser；
- duplicate policy evaluator；
- `/api/v1`；
- old Deep Link；
- Runtime State legacy mirror；
- circular internal package dependency。

允许的 mutation ownership：

```text
runtime/supervisor.mjs
runtime/package-service.mjs
runtime/transaction.mjs
runtime/environment-lock.mjs
runtime/activation-manager.mjs
runtime/registry.mjs
```

上层只能通过 Supervisor / Service contract 调用。

## 14. 实施顺序

本轮一次完成，但提交顺序按依赖推进：

1. 保存本方案；
2. 建立 `policy-core`；
3. 建立统一 CAS Artifact Store；
4. 建立 Runtime Adapter ABI；
5. 建立 Activation Manager + LKG；
6. 建立 Runtime Supervisor；
7. Package Service / Installer / Startup 接入 Policy / CAS / Adapter / Supervisor；
8. Environment Lock 增加 content/trust/policy snapshot；
9. 建立 Secret Store / Config resolver；
10. 建立 Audit Event Contract；
11. 建立 Candidate / Quarantine contract；
12. 加 Architecture Conformance Gate；
13. 补单元、生命周期、并发、恢复、跨平台测试；
14. CI / Phase E / Runtime Platform / Final Acceptance 全部接入；
15. 更新最终架构文档与 PR 说明；
16. 所有 Gate green 后才允许合并。

## 15. 验收标准

必须同时满足：

```text
Protocol V2 unchanged
Registry V4 unchanged
Runtime State V4 compatible with current V4 readers
Policy decisions single-source
all local mutations supervised
CAS digest recorded and verified
activation failure recovers to LKG
no activation retry loop
all package types use adapters
secrets absent from state/lock/audit/http output
candidate/quarantine cannot become install authority
architecture conformance green
transaction/recovery green
Linux/macOS/Windows green
Astro check/build green
API V2/MCP V2 green
npm pack dry-run green
three-platform Registry V4 convergence green
```

任何一项未通过，均不得把本轮标记为完成或发布。
