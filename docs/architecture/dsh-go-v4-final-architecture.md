# DSH Go V4 最终架构

> 本文描述重构后的唯一有效架构。旧 CLI、API V1、Registry V3 公共接口、旧 Deep Link、Runtime State 1/2/3、旧 Manifest 与兼容镜像均不属于当前架构。

## 1. 唯一核心链路

```text
External discovery sources
        ↓
Discovery collector
        ↓
Registry V4 builder + immutable commit resolution
        ↓
Registry V4 (authority)
  ├─ Distribution V2
  ├─ Search Index V3
  ├─ API V2 / MCP Tools V2
  └─ Marketplace V2
        ↓
Package Protocol V2 request
        ↓
Resolver V2
        ↓
Resolution Plan V2 + resolution_hash
        ↓
Local explicit confirmation
        ↓
Transaction Engine V2
        ↓
Artifact/source verification + permission/security checks
        ↓
Atomic filesystem commit
        ↓
Runtime State V4 CAS commit
        ↓
pending-restart
        ↓
explicit startup activation
        ↓
Manifest V2 binding
```

## 2. Package Protocol V2

唯一包身份是 `(type,id)`：

```text
plugin:owner/name
mcp:owner/name
skill:owner/name
agent:owner/name
```

唯一坐标格式：

```text
<type>:<id>@<semver-range>
```

类型必须显式指定。不存在隐式 plugin 类型，不接受 `github:` 包规范。

支持 channel：`stable / beta / nightly / dev`。

所有 CLI、REST、MCP、Deep Link、Runtime 和依赖图必须使用 `packages/protocol-core` 的同一语义。

## 3. Package Manifest V2

唯一 Manifest：

```text
dsh-package.json
```

必须包含：

- `schema_version: 2`
- `type`
- `id`
- `version`

可声明：

- `channel`
- `runtime`
- `entrypoints`
- `capabilities`
- `permissions`
- `dependencies`
- `compatibility`
- `metadata`

Runtime 不再从 `package.json`、`dsh-plugin.json`、`dsh-skill.json`、`SKILL.md` 等文件猜测包身份。内容文件可以作为 entrypoint，但不能替代 Manifest V2。

## 4. Registry V4

Registry V4 是远程安装事实的唯一权威。

```text
Registry V4
├─ schema_version = 4
├─ revision = SHA-256(canonical registry payload)
├─ packages[]
│  ├─ type
│  ├─ id
│  ├─ publisher_id
│  ├─ source
│  ├─ metadata
│  └─ releases[]
│     ├─ version
│     ├─ channel
│     ├─ immutable commit
│     ├─ artifact
│     ├─ dependencies
│     ├─ permissions
│     ├─ compatibility
│     └─ security
├─ publishers[]
└─ advisories[]
```

可安装 release 必须拥有不可变 40-character source commit。不存在可安装的浮动 HEAD 身份。

## 5. Resolver V2

所有消费者共用 `packages/resolver`。

输入：

```text
Package Request V2
+ Registry V4
+ Environment
```

输出：

```text
Resolution Plan V2
├─ root
├─ graph
├─ dependency-first order
├─ aggregate permissions
├─ registry_revision
├─ resolution_hash
└─ restart_required
```

Resolver fail-closed：

- revoked release 不可安装；
- yanked release 不用于新安装；
- critical advisory 命中时阻断；
- dependency conflict / cycle 阻断；
- compatibility 不满足时阻断。

## 6. Runtime State V4

唯一文件：

```text
~/.dsh/state/runtime-v4.json
```

只有：

```text
schema_version
generation
updated_at
packages[]
```

不再存在 `plugins[]` compatibility mirror。

状态写入采用：

- cross-process lock；
- stale owner 检测；
- generation CAS；
- temp file + atomic rename；
- bounded retry。

旧 State Schema 不自动迁移，直接返回 `DSH_STATE_SCHEMA_UNSUPPORTED`。

## 7. Transaction Engine V2

一个 Resolution Plan 作为一个事务提交：

1. 写 durable journal；
2. 按 dependency-first order 安装；
3. 验证 immutable commit / artifact / security evidence；
4. 记录 filesystem moves 与 backup；
5. 全图只执行一次 Runtime State V4 CAS publish；
6. 成功后删除 journal；
7. 失败回滚 filesystem；
8. crash recovery 根据 journal + state transaction event 判断 commit/rollback。

安装、更新、回滚都不自动重启客户端。

## 8. Canonical CLI

```text
dsh package install <type:id@range> --yes
dsh package update <type:id@range> --yes
dsh package remove <type:id@range> --yes
dsh package rollback <type:id@range> --yes
dsh package enable <type:id@range>
dsh package disable <type:id@range>
dsh package verify <type:id@range>
dsh package info <type:id@range>
dsh package list
dsh package plan <type:id@range>

dsh registry status
dsh registry package <type:id@range>

dsh runtime status
dsh runtime activate
dsh runtime register-protocol
```

旧顶层 install、`dsh plugin add`、隐式 package type 等接口全部移除。

## 9. Deep Link V2

唯一格式：

```text
dsh://package/install?spec=<encoded-coordinate>&channel=<channel>
```

安全边界：

- URL 不能提供 Registry；
- URL 不能带 credentials / fragment；
- 未知参数拒绝；
- Host 只生成本地 install plan；
- 本地显式确认后才能执行；
- remote page 无本地写权限。

## 10. Local Host API V2

本地 Host 使用 Bearer token、loopback/allowlist origin、request body limit、no-store。

主要接口：

```text
GET  /v2/runtime/status
POST /v2/runtime/activate
GET  /v2/registry/status
POST /v2/install/plan
POST /v2/install/execute
GET  /v2/packages
GET  /v2/packages/:type/:id
POST /v2/packages/action
GET/PATCH /v2/packages/:type/:id/config
GET/PUT/DELETE /v2/secrets/:name
```

所有 mutation 必须 `approved=true`。Secret value 永不通过 HTTP 返回。

## 11. Edge API V2

远程 API 只读/计划：

```text
GET  /api/v2
GET  /api/v2/capabilities
GET  /api/v2/health
GET  /api/v2/packages
GET  /api/v2/packages/:type/:id
GET  /api/v2/packages/:type/:id/releases
GET  /api/v2/search
POST /api/v2/resolve
POST /api/v2/install-plan
GET  /api/v2/publishers
GET  /api/v2/advisories
GET  /api/v2/registry/revision
GET  /api/v2/registry/delta
POST /api/v2/mcp
```

成功统一为 `{data,meta}`，错误统一为 `{error,meta}`。

## 12. MCP Tools V2

只保留：

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

MCP 不直接修改用户机器。

## 13. Marketplace V2

数据来源只有 Search Index V3 / Registry V4。

核心规则：

- Plugin / MCP / Skill / Agent 同一 Package Model；
- `< 200 stars` 不生成静态详情页；
- 低星但可发现资源使用 source fallback；
- 可安装资源提供 canonical CLI / Deep Link；
- 动态 DOM 使用全局结构样式，不依赖 Astro scoped attribute；
- `en / zh-CN / ja / ko / es` 使用同一 message contract。

## 14. Trust

`Trusted` 与 stars 无关。

真正 Trusted 至少要求：

```text
verified publisher ownership
AND
cryptographic signature verification == true
```

只有 digest、signature metadata、SBOM reference 或 provenance reference 不等于密码学可信。

Revoked / critical advisory 必须 fail-closed。

## 15. Environment Lock V2

Environment Lock 记录：

- `(type,id)`；
- exact version / commit；
- registry revision；
- resolution hash；
- artifact/runtime/security metadata；
- content-addressable snapshot digest。

Restore 是事务，必须显式批准，不自动重启。

## 16. Distribution / Deployment

```text
Registry V4
├─ authority: /catalog/registry-v4.json
├─ Distribution V2: /catalog/registry-v4/index.json + shards
└─ Search V3: /catalog/search-index-v3.json
```

部署 Gate 必须同时验证：

- Protocol 2；
- API v2；
- Registry schema 4；
- exact Registry revision；
- Distribution V2 revision；
- Search V3 revision；
- public file budget；
- legacy public artifacts absent。

三平台以 exact Registry V4 revision 收敛，而不是仅比较文件数量或“部署命令成功”。

## 17. Final Acceptance

Release 必须满足：

```text
contract V4 green
Protocol/Registry/Resolver tests green
Runtime State/transaction tests green
full local lifecycle green
Linux/macOS/Windows green
Astro check/build green
Registry V4 validator green
legacy public surface absent
three-platform deployment convergence green
npm pack dry-run green
```

任何一项失败，都不能标记为发布完成。
