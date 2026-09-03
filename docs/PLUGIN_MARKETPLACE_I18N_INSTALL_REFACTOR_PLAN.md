# DSH Go 插件市场多语言 + `dsh plugin` 安装重构改进方案

> 状态：规划稿 / 三轮收敛版  
> 范围：Marketplace Web、Registry V3、Distribution V1、API V1、DSH CLI、Runtime Installer、Tauri/Host Bridge、文档与三平台部署  
> 原则：不修改上游 DeepSeek Harness；远程市场只负责发现与可信元数据，本地 Runtime 执行安装；安装后不自动重启客户端。

---

## 1. 目标

把当前 `dsh-go` 从“插件市场 + Registry + Runtime 安装能力”进一步收敛为真正可长期演进的 **DSH 原生多语言包管理与插件商城**。

最终用户应能够在不同语言环境下保持完全一致的机器行为：

```bash
dsh plugin search memory
dsh plugin info example-plugin
dsh plugin install example-plugin
dsh plugin install example-plugin@1.2.0
dsh plugin install example-plugin --dry-run
dsh plugin update example-plugin
dsh plugin rollback example-plugin
dsh plugin remove example-plugin
```

同时支持：

```bash
dsh mcp install dsh-go-marketplace
dsh skill install example-skill
dsh agent install example-agent
```

网站上的 Plugin / MCP / Skill / Agent 根据 Registry 类型生成正确命令，不再把所有条目都当作 Plugin。

多语言目标不是只增加一个语言切换按钮，而是覆盖：

1. Marketplace Web；
2. SEO 与静态路由；
3. CLI 人类可读输出；
4. 权限确认与错误提示；
5. API 展示字段；
6. Plugin/MCP/Skill/Agent 的本地化元数据；
7. API 文档、用户文档和安装指南；
8. 日期、数字、复数、方向（LTR/RTL）与无障碍；
9. 三平台 Pages 的内容一致性；
10. CI 中的翻译完整性和回归检测。

---

## 2. 当前实现基线

### 2.1 已经具备的能力

当前代码已经有较完整的 Runtime Installer 基础，因此本轮不应重新开发第二套安装器。

现有核心能力包括：

- `dsh plugin install <id|owner/repo>[@version]`；
- `dsh mcp/skill/agent install`；
- `list/status/update/rollback/remove/enable/disable/doctor/repair/history`；
- Registry V3 解析；
- Distribution V1 与远程 Registry cache；
- dependency DAG；
- 循环依赖检测；
- conflict/replaces/provides；
- yanked package 拦截；
- compatibility 检查；
- permission preflight 与显式 consent；
- Release artifact / fixed Git commit 安装；
- digest、签名、SLSA / supply-chain evidence 扩展；
- Runtime Registry 持久化；
- update backup + rollback；
- 安装后 `restart_required`；
- `dsh://` Host Bridge；
- `dsh startup activate` 启动激活。

因此目标架构应继续保持：

```text
Marketplace discovery
        ↓
Registry / Distribution
        ↓
Local preflight
        ↓
Dependency resolver
        ↓
Permission + compatibility
        ↓
Artifact verification
        ↓
Atomic installer
        ↓
Runtime Registry
        ↓
Pending restart
        ↓
Startup activation
```

### 2.2 当前多语言实现

当前站点已经存在：

```text
site/src/i18n/dict.ts
site/src/scripts/i18n.ts
```

现状是：

- `Lang` 只支持 `zh | en`；
- 页面通过 `localStorage('dsh-lang')` 保存语言；
- 未设置时根据 `navigator.language` 判断中文/英文；
- DOM 通过 `data-i18n` 做客户端替换；
- `<html lang>` 会在客户端更新；
- 分类有独立 i18n key；
- 已有简单变量模板和单复数处理；
- 同一脚本还承担主题切换。

这是良好起点，但仍属于 **客户端字典切换**，还不是完整国际化架构。

### 2.3 当前需要立即修复的问题

#### A. CLI 命令文案已经漂移

现有中英文词典中的安装指南仍出现：

```text
dsh plugin add
```

而当前正式 CLI 已经使用：

```text
dsh plugin install
```

必须统一，避免 Web 指导用户执行旧命令。

#### B. Layout 与字典体系不完全一致

当前 Layout 中仍存在大量硬编码英文：

- Marketplace；
- Profiles；
- Trending；
- Stats；
- API；
- Footer；
- Switch language；
- Toggle theme。

这些字符串没有全部经过翻译 key。

#### C. `<html lang="zh-CN">` 是构建时硬编码

客户端加载后才改语言，会导致：

- 首屏语言与用户设置不一致；
- SEO 抓取仍主要看到默认页面；
- OpenGraph / title / description 无法真正按 locale 输出；
- JS 禁用时无法切换；
- 可能出现 hydration 前的语言闪烁。

#### D. 当前语言模型不可扩展

```ts
export type Lang = 'zh' | 'en';
```

意味着每增加一种语言都需要修改类型、脚本和 toggle 逻辑。

#### E. Registry 只有机器字段，没有本地化展示层

Registry V3 应继续保持语言无关；但 Marketplace 搜索结果需要多语言名称、摘要、分类说明时，目前没有正式的 localization overlay 机制。

#### F. CLI 尚未形成完整国际化约束

未来如果直接翻译 CLI 输出，会破坏自动化脚本。因此必须先定义：

- human output 可以翻译；
- JSON output 永不翻译字段名；
- error code 永不翻译；
- package id / type / version 永不翻译。

---

## 3. 总体设计原则

### 3.1 机器契约与展示语言彻底分离

以下字段必须保持语言无关：

```text
package id
package type
version
channel
commit
artifact URL
SHA / digest
Registry content_hash
capability id
permission id
dependency id
error code
CLI command / option
API JSON field name
```

可以本地化：

```text
display_name
summary
description
category label
tag display label
permission explanation
compatibility explanation
human error message
CLI heading / status text
Web navigation
Docs
```

### 3.2 Registry V3 继续作为安装权威

禁止把翻译内容变成安装身份的一部分。

正确模型：

```text
Registry V3
  └─ package identity + install contract

Localization Overlay
  └─ presentation only
```

这样翻译修改不会导致：

- artifact hash 改变；
- dependency resolution 改变；
- install lock 失效；
- 三平台 Registry content hash 无意义变化。

### 3.3 Locale 统一使用 BCP 47

不继续使用内部 `zh/en` 二元模型作为长期契约。

建议首批：

```text
zh-CN
en
ja
ko
es
```

架构直接支持后续：

```text
fr
de
pt-BR
ru
ar
zh-TW
```

初始并不要求所有语言一次翻译完成，但代码结构必须能够无改动增加 locale。

### 3.4 Fallback 链必须确定

建议：

```text
requested locale
    ↓
locale language family
    ↓
en
    ↓
source/original metadata
```

示例：

```text
pt-BR → pt → en → source
zh-TW → zh → en → source
```

对于 UI 核心词典，CI 不允许落到 raw key；对于第三方插件描述允许 fallback 到英文或仓库原始描述。

---

# 4. 第一轮改善：修复基线 + 建立可扩展 i18n / Install Contract

第一轮的目标不是大改路由，而是先消除现有漂移和重复逻辑，形成稳定基础。

## 4.1 第一轮修复项

### 4.1.1 修复所有安装命令漂移

统一：

```text
dsh plugin add
```

为：

```text
dsh plugin install
```

同时扫描：

```text
README
docs/
site/
API examples
MCP plan_local_install
copy command
plugin detail
install modal
```

防止网站、文档、API 各生成一套命令。

### 4.1.2 建立单一 Install Command Builder

新增类似：

```text
site/src/lib/install-command.ts
```

输入：

```ts
{
  type,
  id,
  version,
  channel
}
```

输出：

```text
plugin → dsh plugin install <id>
mcp    → dsh mcp install <id>
skill  → dsh skill install <id>
agent  → dsh agent install <id>
```

Web、API install plan、MCP tool、Deep Link 页面统一调用同一规则。

不要再在多个 Astro 页面拼字符串。

### 4.1.3 重构 locale 配置

建议新增：

```text
site/src/i18n/config.ts
site/src/i18n/locales/
  zh-CN.ts
  en.ts
  ja.ts
  ko.ts
  es.ts
```

配置：

```ts
export const DEFAULT_LOCALE = 'en';
export const SUPPORTED_LOCALES = [
  'en',
  'zh-CN',
  'ja',
  'ko',
  'es',
] as const;
```

当前巨大 `dict.ts` 应逐步拆分，但第一轮保留兼容导出，避免一次性重写所有页面。

### 4.1.4 把主题逻辑与 i18n 解耦

当前 `site/src/scripts/i18n.ts` 同时负责语言和主题。

拆成：

```text
site/src/scripts/i18n.ts
site/src/scripts/theme.ts
```

理由：

- 两者生命周期不同；
- 语言切换需要路由/SEO 演进；
- 主题只是客户端偏好；
- 避免以后 i18n 重构影响 theme。

### 4.1.5 所有 UI 字符串进入翻译 key

必须覆盖：

- Layout nav；
- footer；
- title/description；
- 安装按钮；
- 权限提示；
- restart required；
- empty/error/loading；
- stats；
- profiles；
- trending；
- search/filter/sort；
- copy success；
- health/trust badge。

禁止在组件里新增长段硬编码可见字符串。

### 4.1.6 CLI 国际化基础

新增类似：

```text
runtime/i18n/
  index.mjs
  en.mjs
  zh-CN.mjs
```

Locale 优先级：

```text
--lang
DSH_LANG
~/.dsh/config.json
LC_ALL / LC_MESSAGES / LANG
system locale
en
```

新增：

```bash
dsh --lang zh-CN plugin list
dsh --lang en plugin install example
```

机器输出规则：

```bash
dsh plugin list --json
```

`--json` 字段名和枚举绝不翻译。

错误模型：

```json
{
  "code": "DSH_PERMISSION_CONSENT_REQUIRED",
  "message": "localized human text",
  "details": {}
}
```

其中 `code` 永久稳定。

## 4.2 第一轮测试

新增：

```text
tests/i18n-contract.test.ts
tests/install-command-contract.test.ts
tests/cli-i18n-contract.test.ts
```

至少验证：

1. 每个 supported locale 都包含 required UI keys；
2. 不允许出现 `dsh plugin add`；
3. 4 种 package type 安装命令正确；
4. JSON CLI output 与 locale 无关；
5. error code 与 locale 无关；
6. 未知 locale fallback 到 `en`；
7. locale 文件不存在时 fail closed 到 fallback，而不是渲染 key；
8. i18n 初始化保持幂等，不重复挂事件。

## 4.3 第一轮验收

第一轮结束后应达到：

```text
双语实现 → 可扩展多语言框架
硬编码 UI → 全部 key 化
add/install 漂移 → 单一安装命令生成器
主题+i18n 耦合 → 分离
CLI 无语言规则 → human/json 双轨契约
```

---

# 5. 第二轮改善：路由、SEO、API、Registry Localization 深度重构

第一轮解决“代码可扩展”，第二轮解决“平台真的多语言”。

## 5.1 从纯客户端切换升级为 locale-aware 静态路由

建议正式生成：

```text
/en/
/zh-CN/
/ja/
/ko/
/es/
```

以及：

```text
/en/plugin/<id>
/zh-CN/plugin/<id>
/ja/plugin/<id>
...
```

旧 URL 不直接删除。

兼容策略：

```text
/                  → 默认兼容入口
/plugin/<id>       → 默认 locale alias
/<locale>/...      → 新 canonical locale route
```

语言切换不再只更新 DOM，而是切换对应 locale URL。

## 5.2 SEO 正式国际化

每个 locale page 输出：

```html
<html lang="ja">
<link rel="alternate" hreflang="en" ...>
<link rel="alternate" hreflang="zh-CN" ...>
<link rel="alternate" hreflang="ja" ...>
<link rel="alternate" hreflang="x-default" ...>
```

并本地化：

- title；
- meta description；
- OpenGraph title/description；
- JSON-LD display text；
- sitemap locale alternates。

Canonical 不能继续无条件指向同一无语言路径。

## 5.3 Plugin Localization Overlay

不修改 package identity。

建议新增：

```text
catalog/i18n-v1/index.json
catalog/i18n-v1/en.json
catalog/i18n-v1/zh-CN.json
catalog/i18n-v1/ja.json
...
```

数据结构示例：

```json
{
  "locale": "zh-CN",
  "packages": {
    "plugin:example": {
      "display_name": "示例插件",
      "summary": "...",
      "description": "...",
      "tags": {
        "memory": "记忆"
      }
    }
  }
}
```

注意：

- package key 使用稳定 `type:id`；
- localization hash 独立于 Registry hash；
- 翻译缺失允许 fallback；
- 第三方仓库描述可作为 source text；
- 自动机器翻译必须标记来源，不作为 verified publisher 文案。

## 5.4 API 多语言展示层

核心 Registry API 保持原样：

```text
/api/v1/registry
/api/v1/registry/delta
```

这些接口继续语言无关。

Marketplace presentation API 可支持：

```http
GET /api/v1/search?q=memory&locale=ja
Accept-Language: ja,en;q=0.8
```

返回：

```json
{
  "plugin": {
    "id": "example",
    "type": "plugin",
    "version": "1.2.0"
  },
  "presentation": {
    "locale": "ja",
    "fallback": false,
    "display_name": "...",
    "summary": "..."
  }
}
```

不要把 localized field 混进安装 resolver 输入。

## 5.5 Search 多语言索引

搜索权重建议：

```text
exact package id
repository name
localized display_name
localized summary
tags/topics
original description
```

搜索索引可按 locale 分片：

```text
catalog/search-v1/en.json
catalog/search-v1/zh-CN.json
...
```

这样不必为了搜索日文加载完整 Registry。

## 5.6 Deep Link 保留 locale 上下文

Web：

```text
dsh://install/plugin/example?version=1.2.0&locale=ja
```

Host Bridge 可把 locale 作为 **展示偏好** 传给本地确认 UI，但不能改变 resolver 结果。

即：

```text
locale influences message
locale never influences package identity
```

## 5.7 权限与安全提示本地化

稳定权限 ID：

```text
filesystem.read
filesystem.write
network
network.unrestricted
shell
secrets.read
mcp.tools
process.spawn
```

展示：

```text
permission.id = shell
permission.label[zh-CN] = Shell 命令执行
permission.description[ja] = ...
```

用户确认记录保存 permission ID，不保存翻译后的字符串。

## 5.8 三平台多语言一致性

Cloudflare Pages / GitHub Pages / EdgeOne Pages 每次部署新增检查：

1. locale manifest hash；
2. locale route 数量；
3. sitemap alternates；
4. locale fallback contract；
5. exact deployment SHA；
6. Registry content hash；
7. i18n overlay hash。

Monitor 中增加：

```text
/en/
/zh-CN/
/ja/
```

抽样 smoke。

## 5.9 第二轮验收

达到：

```text
JS 字典切换
    ↓
静态 locale 路由 + SEO

Registry 内塞展示字段
    ↓
Registry + Localization Overlay 分离

API 单语言
    ↓
Accept-Language / locale presentation

搜索只理解原始英文
    ↓
多语言 search projection
```

---

# 6. 第三轮改善：生产级语言治理、全球化、长期维护

第三轮解决长期运行问题，避免语言越多维护成本指数增长。

## 6.1 翻译 Source-of-Truth

定义唯一源：

```text
locales/<locale>/ui.json
locales/<locale>/permissions.json
locales/<locale>/docs/
```

构建时生成 Astro / CLI 需要的格式。

禁止 Web、CLI、Docs 各维护独立翻译副本。

## 6.2 Translation Schema

为翻译文件增加 schema：

```text
schemas/i18n-ui.schema.json
schemas/i18n-package.schema.json
```

CI 验证：

- key 缺失；
- 多余 key；
- 参数占位符不一致；
- HTML token 被误删；
- 非法 locale；
- Unicode 控制字符；
- bidi spoofing；
- URL 被翻译；
- CLI command 被翻译。

## 6.3 ICU Message / 复数规则

当前 `n === 1` 的逻辑不足以支持多语言。

第三轮迁移到基于 `Intl.PluralRules` 或兼容 ICU MessageFormat 的实现：

```text
zero
one
two
few
many
other
```

同时统一：

- `Intl.DateTimeFormat`；
- `Intl.NumberFormat`；
- `Intl.RelativeTimeFormat`；
- timezone display。

机器数据仍保持 ISO 8601 UTC。

## 6.4 RTL 预留

加入 locale metadata：

```json
{
  "locale": "ar",
  "direction": "rtl"
}
```

CSS 优先使用：

```text
margin-inline
padding-inline
inset-inline
border-inline
```

减少 left/right 硬编码。

即使首批不发布阿拉伯语，也让架构不需要再次推翻。

## 6.5 Pseudo Locale 自动测试

新增：

```text
en-XA
ar-XB
```

用于自动发现：

- 文本溢出；
- 按钮宽度不足；
- 绝对定位；
- RTL 布局问题；
- 未经过翻译系统的硬编码字符串。

Pseudo locale 不发布到生产导航，只用于 CI / visual test。

## 6.6 翻译覆盖率门禁

建议定义等级：

```text
Tier 0: en
Tier 1: zh-CN, ja, ko, es
Tier 2: fr, de, pt-BR, zh-TW
Tier 3: community locales
```

发布门禁：

```text
Tier 0 = 100%
Tier 1 UI critical = 100%
Tier 1 full = >= 95%
Tier 2 可 fallback
```

安全与权限提示必须 100%，不能 fallback 到不明确机器翻译。

## 6.7 文档国际化

建议目录：

```text
docs/i18n/en/
docs/i18n/zh-CN/
docs/i18n/ja/
```

但是架构设计文档本身可以继续以一种主语言维护；面向最终用户的：

- Installation；
- CLI reference；
- Permission model；
- Troubleshooting；
- Marketplace publishing；
- Security；
- Plugin author guide；

才进入正式多语言发布链。

## 6.8 Community Translation

后续允许社区 PR：

```text
locales/<locale>/*
```

增加 CODEOWNERS 或 locale maintainer。

翻译 PR 不应有修改：

- runtime resolver；
- install identity；
- package hash；
- permission id。

CI 强制限制 translation-only PR 的影响范围。

## 6.9 多语言安全边界

禁止通过翻译改变：

```text
install command
package id
URL host
permission id
shell snippet
security verdict
version
SHA
```

任何带 HTML 的翻译必须经过严格 allowlist；长期应优先结构化 rich-text token，减少 `innerHTML`。

## 6.10 第三轮验收

达到：

```text
多语言是平台能力，而不是页面功能
翻译可以独立演进，而不会改变安装身份
新 locale 可以主要通过数据提交加入
Web / CLI / Docs 共享语言契约
三平台能验证 locale 内容收敛
安全提示不会因翻译产生权限歧义
```

---

# 7. 最终目标架构

```text
                         DSH Marketplace
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
     Locale Web             DSH CLI           Marketplace MCP
          │                    │                    │
          └────────────────────┼────────────────────┘
                               │
                     Marketplace API V1
                               │
           ┌───────────────────┴───────────────────┐
           │                                       │
     Presentation Layer                      Install Contract
           │                                       │
 Localization / Search                  Registry V3 / Distribution
           │                                       │
           │                              Local Runtime Resolver
           │                                       │
           │                               Dependency DAG
           │                                       │
           │                         Permission / Compatibility
           │                                       │
           │                           Artifact Verification
           │                                       │
           └───────────────────────────────┬───────┘
                                           │
                                      Installer
                                           │
                                   Runtime Registry
                                           │
                                   Pending Restart
                                           │
                                   Startup Activate
```

关键约束：

```text
Presentation 可以多语言
Install Contract 永远语言无关
```

---

# 8. 建议数据结构

## 8.1 Locale manifest

```json
{
  "schema_version": 1,
  "default_locale": "en",
  "locales": [
    { "id": "en", "name": "English", "direction": "ltr", "tier": 0 },
    { "id": "zh-CN", "name": "简体中文", "direction": "ltr", "tier": 1 },
    { "id": "ja", "name": "日本語", "direction": "ltr", "tier": 1 },
    { "id": "ko", "name": "한국어", "direction": "ltr", "tier": 1 },
    { "id": "es", "name": "Español", "direction": "ltr", "tier": 1 }
  ]
}
```

## 8.2 Package localization record

```json
{
  "package_key": "plugin:example",
  "locale": "zh-CN",
  "display_name": "Example 插件",
  "summary": "...",
  "description": "...",
  "source": "publisher|community|machine",
  "reviewed": true,
  "updated_at": "2026-09-03T00:00:00Z"
}
```

## 8.3 Runtime 本地设置

```json
{
  "locale": "zh-CN"
}
```

仅影响 human presentation。

---

# 9. CLI 最终契约

## 9.1 Locale

```bash
dsh --lang zh-CN plugin search memory
dsh --lang ja plugin info example
```

也支持：

```bash
DSH_LANG=ko dsh plugin list
```

## 9.2 JSON 永远稳定

```bash
dsh plugin list --json
```

不同语言执行后 JSON schema 必须完全一致。

## 9.3 Search / Info / Outdated

补齐产品级命令：

```bash
dsh plugin search <query>
dsh plugin info <id>
dsh plugin outdated [id]
```

不要为了 search 下载完整 Registry；优先使用 Marketplace lightweight search index / API。

安装仍必须回到 Registry V3 权威记录。

## 9.4 安装语义

长期目标：

```text
无版本             → latest stable
@1.2.0             → exact
@^1.2.0            → semver range
--channel beta     → latest beta
--channel nightly  → latest nightly
```

不要把 `defaults.plugin_version = 0.1.0` 长期解释为“用户未指定版本时永远安装 0.1.0”。

---

# 10. Marketplace 自身包的正确定位

当前独立包：

```text
dsh-go-marketplace
```

类型是 MCP，因此正确安装方式继续保持：

```bash
dsh mcp install dsh-go-marketplace
```

不要为了满足 `dsh plugin install` 简单把现有 MCP manifest 改成 plugin。

如果需要 Desktop/Host 内的 Marketplace UI 插件，建议新增独立包：

```text
dsh-go-marketplace-plugin
```

对应：

```bash
dsh plugin install dsh-go-marketplace-plugin
```

两者共享：

```text
Marketplace API
Registry
Localization Overlay
```

而不复制 catalog。

---

# 11. 文件级重构建议

## Web

```text
site/src/i18n/config.ts
site/src/i18n/index.ts
site/src/i18n/locales/en.ts
site/src/i18n/locales/zh-CN.ts
site/src/i18n/locales/ja.ts
site/src/i18n/locales/ko.ts
site/src/i18n/locales/es.ts
site/src/lib/install-command.ts
site/src/lib/locale-routing.ts
site/src/scripts/i18n.ts
site/src/scripts/theme.ts
```

## Runtime / CLI

```text
runtime/i18n/index.mjs
runtime/i18n/en.mjs
runtime/i18n/zh-CN.mjs
runtime/output.mjs
```

长期 Web 与 Runtime 可共享生成源，而不是人工复制相同 key。

## Catalog

```text
catalog/i18n-v1/index.json
catalog/i18n-v1/<locale>.json
catalog/search-v1/<locale>.json
```

## Schema

```text
schemas/i18n-manifest.schema.json
schemas/i18n-package.schema.json
```

## Tests

```text
tests/i18n-contract.test.ts
tests/i18n-routing.test.ts
tests/i18n-overlay.test.ts
tests/install-command-contract.test.ts
tests/cli-i18n-contract.test.ts
tests/i18n-deployment-contract.test.ts
```

---

# 12. CI / Release Gate

每个 PR 至少检查：

```text
typecheck
lint
unit tests
i18n key completeness
placeholder parity
hardcoded UI string detector
legacy command detector
locale schema validation
Registry validation
install command contract
CLI JSON stability
site build for all Tier 0/1 locales
pseudo-locale build
```

生产部署再检查：

```text
exact Git SHA
Registry V3 content hash
Localization overlay hash
Provider Adapter hash
locale manifest
locale route smoke
hreflang / sitemap
```

---

# 13. 三轮方案如何逐步修正前一轮不足

## 第一轮

解决：

- 当前明显错误；
- 中英硬编码；
- `add/install` 漂移；
- i18n 与主题耦合；
- CLI 没有 human/machine 输出边界。

但第一轮仍保留兼容页面结构，不贸然改变 URL。

## 第二轮

修正第一轮仍然存在的结构性问题：

- 客户端翻译不利于 SEO；
- package metadata 没有本地化模型；
- 搜索不能理解多个语言；
- 三平台没有 locale convergence；
- deep link 没有 locale context。

因此引入 locale route + localization overlay + API presentation layer。

## 第三轮

修正第二轮规模扩大后的治理问题：

- 翻译 key 容易漂移；
- 新语言维护成本高；
- plural/date/RTL 复杂度增加；
- 社区翻译可能误改安全或安装字段；
- 多平台容易出现 locale 文件部分更新。

因此加入 schema、coverage gate、pseudo locale、RTL、安全约束和 translation governance。

---

# 14. 优先级

## P0

1. `dsh plugin add` → `dsh plugin install` 全量修复；
2. 单一 Install Command Builder；
3. locale config 从 `zh/en` 升级为可扩展 BCP 47；
4. Layout/组件所有可见字符串 key 化；
5. theme 与 i18n 拆分；
6. CLI human/json 输出边界；
7. 第一批 contract tests。

## P1

1. locale-aware routes；
2. SEO/hreflang；
3. Localization Overlay V1；
4. API locale presentation；
5. multilingual search index；
6. permission localization；
7. Deep Link locale context；
8. 三平台 locale convergence。

## P2

1. Translation schema；
2. ICU / plural rules；
3. RTL；
4. pseudo locales；
5. coverage gates；
6. docs localization；
7. community translation governance；
8. Marketplace UI plugin 独立包。

---

# 15. 完成定义（Definition of Done）

只有同时满足以下条件，才能认为“多语言 + `dsh plugin` 插件市场闭环”真正完成：

- [ ] Plugin/MCP/Skill/Agent 页面能生成正确 CLI install 命令；
- [ ] 不存在公开文案中的 `dsh plugin add`；
- [ ] Web 至少发布 `en/zh-CN/ja/ko/es` 架构能力；
- [ ] 语言切换不会改变 package identity；
- [ ] CLI human output 可本地化；
- [ ] CLI JSON output 在所有 locale 下一致；
- [ ] 权限 ID、error code、capability ID 永不翻译；
- [ ] Registry V3 hash 不受翻译变化影响；
- [ ] Search API 能返回 locale presentation；
- [ ] Localization Overlay 有独立 schema/hash；
- [ ] locale route 有 canonical/hreflang/sitemap；
- [ ] 三个 Pages 平台验证相同 Registry + locale revision；
- [ ] `dsh plugin install` 执行 preflight → dependency → permission → verify → install；
- [ ] 安装成功只提示 restart，不自动重启；
- [ ] 下次启动通过 `dsh startup activate` 激活；
- [ ] update 失败可恢复/rollback；
- [ ] Tier 0/1 翻译通过覆盖率门禁；
- [ ] pseudo-locale / RTL 基础测试通过；
- [ ] Web / CLI / Docs 不再维护互相漂移的安装语义。

---

## 16. 最终建议

本次重构不应重新开发 Installer，也不应把多语言文本直接塞进 Registry V3。

应围绕两个核心边界收口：

### 边界一：安装只有一个权威链路

```text
Marketplace → Registry V3 → Local Runtime Installer
```

### 边界二：语言只改变展示，不改变机器身份

```text
Localization → Presentation
Registry → Identity / Install
```

按上述三轮推进，可以在不破坏现有 `0.1.x` Runtime/API 兼容契约的前提下，把 `dsh-go` 从当前中英文插件市场升级成可扩展到多语言、可通过 `dsh plugin` 原生安装、可由三平台稳定分发、并具备长期翻译治理能力的 DSH 生态基础设施。
