# DSH Go V4 架构强化与全面优化计划

> 状态：实施基线。本文在 `docs/architecture/dsh-go-v4-final-architecture.md` 基础上继续强化内部架构，但保持 Package Protocol V2、Registry V4、API V2 与 Runtime State V4 的公共契约稳定。目标是让 PR #137 成为最后一次大规模破坏性架构重置，之后进入可持续的小版本演进。

## 1. 总体原则

1. 不恢复旧 CLI、API V1、Registry V3、旧 Deep Link、旧 Runtime State 或兼容镜像。
2. 不再为了内部重构升级公共协议版本；内部实现通过模块化和边界收敛完成。
3. Local Runtime 是唯一写权威；Marketplace、Edge API、MCP 只发现、解析与生成计划。
4. 所有包类型统一身份与解析协议，但允许通过 Runtime Adapter 拥有不同执行生命周期。
5. 所有安全决策必须由统一 Policy Engine 输出，禁止 Resolver、Installer、Host 各自复制策略。
6. 所有可安装字节必须先通过完整性、来源和策略验证，再进入 Content-Addressable Store。
7. 激活与安装分离；失败激活必须自动回滚到 Last-Known-Good generation，避免启动死循环。
8. Secrets 不进入 Runtime State、Registry、Environment Lock、日志或远程 API。
9. 架构约束本身进入 CI，防止未来重新长出重复 Resolver、SemVer、Parser、状态写路径。

## 2. 目标九层架构

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
Security / Secrets
Environment Lock / Recovery
```

## 3. Runtime Supervisor：唯一写入入口

### 目标
CLI、Desktop、Deep Link Host、Local Host API 都不得直接写 Runtime State 或安装目录，所有 mutation 统一进入 Runtime Supervisor。

```text
CLI ─────────┐
Desktop ─────┤
Deep Link ───┼──> Runtime Supervisor
Local API ───┘          │
                         ├─ Policy Engine
                         ├─ Resolver
                         ├─ Transaction Engine
                         ├─ CAS Store
                         ├─ Runtime State
                         └─ Activation Manager
```

### 要求
- single-writer operation lock；
- operation_id/request_id；
- explicit approval；
- mutation serialisation；
- generation before/after；
- audit logging；
- recoverable/recovery_required 错误语义；
- lock/CAS 继续作为底层防线，而不是主要协调机制。

## 4. Policy Engine：统一安全决策

新增/强化 `packages/policy-core`，所有消费者只接受 PolicyDecision：

```text
PolicyInput
├─ operation
├─ package/release
├─ publisher
├─ registry identity
├─ permissions/capabilities
├─ advisory state
├─ cryptographic verification
├─ environment compatibility
└─ explicit approval

PolicyDecision
├─ allow
├─ deny
├─ require-confirmation
├─ trust classification
├─ required_permissions[]
├─ reasons[]
└─ warnings[]
```

硬阻断：revoked、critical advisory、required signature 未验证、signer revoked、runtime incompatible、禁止的新安装 yanked release。

## 5. Content-Addressable Artifact Store

所有安装字节使用 SHA-256 digest 唯一寻址：

```text
~/.dsh/store/sha256/<digest>/
```

流程：

```text
Download → Verify digest/source/trust → CAS import → staging materialization → transaction commit
```

要求：
- immutable blob/tree identity；
- atomic import；
- dedup；
- pin/reference model；
- rollback/Environment Restore 复用 CAS；
- GC 只能清理无引用对象；
- CAS mutation 也通过 Supervisor。

## 6. Trust Root / Publisher Identity

Trust 与 popularity 完全分离。

```text
Publisher Identity
├─ repository ownership
├─ signing identities/public keys
├─ key rotation
├─ key revocation
└─ provenance identity

Release Evidence
├─ artifact digest
├─ cryptographic signature
├─ provenance
├─ SBOM
└─ verification result
```

`trusted` 只能由 verified publisher ownership + cryptographic signature verification 得到。声明了 signature metadata、digest 或 SBOM 不等于 trusted。

Environment Lock 必须保留安装时 trust snapshot，确保历史状态可解释。

## 7. Activation Manager + Last-Known-Good

安装成功不代表自动激活。Runtime 使用 generation 模型：

```text
installed
  ↓
pending-activation
  ↓
preflight
  ↓
candidate generation
  ↓
activate + health check
  ├─ PASS → active + last_known_good
  └─ FAIL → rollback last_known_good
```

要求：
- active_generation；
- candidate_generation；
- last_known_good_generation；
- bounded boot attempts；
- crash marker；
- activation health timeout；
- 失败后不重复自动尝试导致启动死循环。

## 8. Runtime Adapter ABI

统一 Package Model，不统一强制执行实现。

```text
PackageRuntimeAdapter
├─ validate
├─ prepare
├─ bind
├─ activate
├─ health
├─ deactivate
└─ cleanup
```

实现：
- PluginRuntimeAdapter
- McpRuntimeAdapter
- SkillRuntimeAdapter
- AgentRuntimeAdapter

Loader/Activation 只依赖 adapter registry，不允许扩展新的 `if (type === ...)` 分支。

## 9. Discovery Candidate / Quarantine Pipeline

远程采集结果禁止直接成为 Registry 权威数据。

```text
External Sources
  ↓
Collector
  ↓
Candidate Store
  ↓
Normalize
  ↓
Manifest validation
  ↓
Immutable commit resolution
  ↓
Security / Trust evaluation
  ↓
Quarantine / Approval
  ↓
Registry V4 Builder
```

候选包必须带 source provenance、normalization result、validation errors、trust evaluation、quarantine reason。Registry Builder 只读取 accepted candidate。

## 10. Config / Secret Architecture

配置层：

```text
defaults → user → workspace → package → effective runtime config
```

Secret 只存 secret reference：

```text
secret_ref: provider/openai/api-key
```

真实值使用 OS native key protection / credential backend：
- Windows DPAPI / Credential Manager；
- macOS Keychain；
- Linux Secret Service；
- 无 native backend 时只允许显式启用受保护的本地加密 fallback。

Secret value 禁止进入：Runtime State、Environment Lock、Registry、Audit/Event logs、HTTP list/read responses。

## 11. Observability / Audit Event Contract

每次 mutation 输出结构化审计事件：

```text
request_id
operation_id
transaction_id
package_coordinate
registry_revision
resolution_hash
operation
policy_snapshot
generation_before
generation_after
result
duration_ms
error_code
recoverable
recovery_required
```

审计日志 append-only、secret redaction、bounded rotation，不把 Runtime State 做成 event sourcing。

## 12. Environment Lock / Recovery 强化

Lock 必须记录：
- exact package coordinate；
- immutable source commit；
- registry revision；
- resolution hash；
- CAS digest；
- runtime metadata；
- security/trust snapshot；
- config references（不含 secret values）。

Restore 是一个完整事务，必须经过 Policy Engine 和 Supervisor，失败回滚，不自动重启。

## 13. Architecture Conformance Gate

CI 必须验证下列依赖方向：

```text
site       !=> runtime internals
functions  !=> installer/runtime mutation
MCP        !=> local filesystem mutation
Resolver   !=> network/filesystem state mutation
Protocol   !=> Registry implementation
Registry   !=> Runtime
CLI/Host   !=> direct runtime state write
```

同时禁止：
- duplicate SemVer implementation；
- duplicate package-coordinate parser；
- duplicate permission/trust evaluator；
- `/api/v1`；
- old Deep Link；
- Runtime State compatibility mirror；
- Registry V3 public authority；
- legacy Marketplace detail route；
- circular package dependencies。

## 14. Distribution / Deployment

保持 Registry V4、Distribution V2、Search Index V3 公共契约不变，继续强化：
- registry revision 一致；
- distribution/search revision 一致；
- exact deployment SHA；
- Cloudflare/GitHub Pages/EdgeOne exact revision convergence；
- public file count/size budget；
- no legacy public artifacts；
- no stale generated files；
- deployment failure 必须区分 build、artifact、provider、convergence 四类。

## 15. 实施阶段

### Phase A — 架构权威
- 固化本方案和最终架构文档；
- Protocol/Registry/Resolver 公共版本冻结；
- Architecture Conformance Gate。

### Phase B — Runtime Single Writer
- Runtime Supervisor；
- Local Host/CLI/Deep Link/Activation/Restore mutation 全部经 Supervisor；
- 直接写状态路径禁止。

### Phase C — Security Core
- Policy Engine；
- Trust Root；
- Advisory/permission/compatibility 统一决策；
- Secret backend。

### Phase D — Artifact / Recovery
- CAS Store；
- Transaction 与 CAS 集成；
- Environment Lock trust/CAS snapshot；
- LKG Activation recovery。

### Phase E — Runtime ABI
- Runtime Adapter registry；
- Plugin/MCP/Skill/Agent adapters；
- loader/startup 取消 type 分支。

### Phase F — Registry Ingress
- Candidate Store；
- normalize/validate/quarantine；
- Registry V4 builder 只接受 accepted candidates。

### Phase G — Observability / CI / Deployment
- Audit event contract；
- secret redaction；
- cross-platform tests；
- architecture tests；
- three-platform convergence。

## 16. 最终验收

PR #137 只有同时满足下列条件才能合并：

```text
Protocol V2 contract green
Manifest V2 green
Registry V4 validation green
Resolver V2 graph/security green
Policy Engine green
CAS integrity/GC green
Runtime Supervisor single-writer green
Runtime State V4 concurrency/CAS green
Transaction crash recovery green
Activation LKG recovery green
Runtime adapters green
Secret backend/redaction green
Environment Lock restore green
Architecture Conformance green
API V2/MCP V2 green
Marketplace/Astro build green
Linux/macOS/Windows green
npm pack dry-run green
three-platform exact revision convergence green
legacy surface absent
```

任何一项失败，都继续修复，不通过降级兼容旧接口来换取 CI green。
