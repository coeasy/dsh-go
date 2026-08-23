# DSH Plugins Nav — 完整部署方案（从零到线上）

> 面向对象的完整操作流程：注册账号 → 推送代码 → 配置自动化 → 首次部署 → 全自动运行。
> 每个步骤含**具体点击路径 / 命令**。验收细节见 [FIRST_DEPLOY_CHECKLIST.md](./FIRST_DEPLOY_CHECKLIST.md)。
> 部署方式：**GitHub Actions 构建 + Cloudflare Pages Direct Upload**（不连接 Git、不配构建命令，避免双重构建）。

---

## 架构回顾（为什么这样部署）

```
你本地 push 代码
      │
      ▼
GitHub 公开仓库
  ├─ sync.yml   每日08:18全量 + 每6h增量 + 手动触发 → 抓数据→commit
  ├─ deploy.yml push到main → npm构建 → cloudflare/pages-action 上传 site/dist
  └─ monitor.yml 每小时健康检查 → 失败邮件
      │
      ▼
Cloudflare Pages（Direct Upload 项目）
  ├─ 静态层：/ /plugin/* /catalog/* /feed.xml /openapi.json（无限免费）
  └─ Functions：/api/v1/* 动态 API（10万次/天免费）
```

**核心思想**：构建和数据生成全在 GitHub（免费），Cloudflare 只负责托管和 API，两者通过 API Token 对接。全程无需服务器、无需付费。

---

## 阶段 0：账号准备（约 5 分钟）

| 账号 | 用途 | 准备什么 |
|---|---|---|
| GitHub | 代码仓库 + Actions | 已注册即可，无需升级 |
| Cloudflare | 托管 + API | 免费账号即可，无需信用卡 |

> 首次部署可全部用免费额度完成，见 DEPLOYMENT_V2.md §9.4 费用总账。

---

## 阶段 1：本地初始化与推送（约 10 分钟）

### 1.1 初始化 git 并首次提交

在项目根目录 `P:\github_public\DSHPlugins` 执行：

```bash
git init
git add -A
git commit -m "feat: DSH Plugins Nav v2.0 全自动插件导航 (方案C + 真API)"
```

> ⚠️ 提交前请确认 `catalog/plugins.json` 是真实数据还是测试数据：
> ```bash
> node -e "console.log(require('./catalog/plugins.json').meta.count)"
> ```
> 若输出 `5`（测试数据），建议先跑一次真实同步（见 1.2），或稍后靠首次 Sync 工作流自动覆盖。

### 1.2（可选）本地先跑一次真实全量同步

```bash
npm ci
npm run sync
```

预期：`完成：N 个插件`（N 为真实数量），`catalog/plugins.json` 的 `meta.count` 变为真实值。
若本步成功，重新 `git add -A && git commit -m "chore(sync): 真实数据"`。

> 不跑也可：部署后手动触发一次 Sync 工作流同样能拿到真实数据（见阶段 4）。

### 1.3 创建 GitHub 公开仓库并推送

1. GitHub → 右上角 **+** → **New repository** → 名称 `dsh-hub` → **Public** → 不勾选初始化文件（README 等）→ Create
2. 按 GitHub 提示推送已有仓库：

```bash
git branch -M main
git remote add origin https://github.com/<你的用户名>/dsh-hub.git
git push -u origin main
```

预期：push 后 GitHub Actions 自动触发 **Deploy** 工作流（首次会尝试构建部署，此时 Cloudflare 还没配好会失败，没关系，稍后重跑）。

---

## 阶段 2：Cloudflare 侧配置（约 10 分钟）

### 2.1 创建 Pages 项目（Direct Upload）

1. 登录 [Cloudflare](https://dash.cloudflare.com) → 左侧 **Workers & Pages** → **Create** → **Pages**
2. 选 **Upload assets**（不要选 Connect to Git）
3. 项目名填 `dsh-hub` → **Create project**
4. 进入项目页，记下 **Production 域名**：`https://dsh-hub.pages.dev`

> ⚠️ 关键：**不连接 Git、不填 Framework preset、不配 Build command**。构建全部由 GitHub Actions 完成，Cloudflare 只接收上传的 `site/dist` 产物。若配了构建命令，会与 Action 双重构建。

### 2.2 创建 API Token

1. Cloudflare 右上角头像 → **My Profile** → **API Tokens** → **Create Token**
2. 选模板 **Edit Cloudflare Workers**（包含 Pages 读写权限），或自定义：
   - Permissions: `Account - Cloudflare Pages - Edit`
   - Account Resources: 你的主账号
3. **Create and continue** → 复制 Token（仅显示一次，立即保存）

### 2.3 记录 Account ID

Cloudflare 控制台右侧栏（或 Workers & Pages 项目页）显示的 **Account ID**，复制保存。

---

## 阶段 3：GitHub 侧配置 Secrets（约 5 分钟）

进入你的仓库 → **Settings** → **Secrets and variables** → **Actions**：

### 添加 2 个 Secrets

| 名称 | 值 | 获取位置 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | 阶段 2.2 的 Token | 刚复制的 Token |
| `CLOUDFLARE_ACCOUNT_ID` | 阶段 2.3 的 Account ID | CF 控制台 |

操作：**New repository secret** → 填名称和值 → Add secret（逐个添加）。

### 添加 1 个 Variable

| 类型 | 名称 | 值 |
|---|---|---|
| Variables | `SITE_URL` | `https://dsh-hub.pages.dev` |

操作：**New repository variable** → 填名称和值 → Add variable。

> `SITE_URL` 供 monitor.yml 健康检查使用；`CLOUDFLARE_*` 供 deploy.yml 部署使用。`GITHUB_TOKEN` 由 GitHub 自动注入，无需配置。

---

## 阶段 4：首次部署（约 5 分钟）

### 4.1 触发 Deploy 工作流

仓库 → **Actions** → 左侧 **Deploy** → **Run workflow** → 绿色按钮。

预期：
- 6 个步骤全绿：Checkout → Setup Node → Install site dependencies → Copy catalog → Build site → **Deploy to Cloudflare Pages**
- Deploy 步骤输出 Pages 部署 URL

### 4.2 常见失败排查

| 现象 | 原因 | 修复 |
|---|---|---|
| Deploy 步骤红 | `CLOUDFLARE_ACCOUNT_ID` 填错 / Token 权限不足 | 核对阶段 2/3 配置 |
| Build 步骤红 | `npm ci` 网络失败 / 依赖版本 | 重跑一次；若持续看日志 |
| 404 页面 | 域名打错 | 用项目 Production 域名 `https://dsh-hub.pages.dev` |

### 4.3 访问验收

浏览器打开 `https://dsh-hub.pages.dev`：
- 首页有插件卡片（若仍是 0 个，是测试数据还没被覆盖，进入阶段 5）
- 顶部导航可点：首页 / API 文档 / 统计 / RSS

---

## 阶段 5：启动全自动同步（约 5 分钟）

### 5.1 触发首次全量同步

仓库 → **Actions** → **Sync Plugins** → **Run workflow**（mode 选 `full`）→ Run。

预期自动链路：
1. Sync 工作流绿色，输出 `完成：N 个插件`（真实数据）
2. 自动产生 commit `chore(sync): 更新插件目录 (N 个插件, full)` 并 push
3. 该 push **自动触发 Deploy 工作流**
4. Deploy 完成后，站点数据更新为真实数据

验证：

```bash
curl -s https://dsh-hub.pages.dev/api/v1/meta
# 预期返回 updated_at、count=N、last_sync
```

### 5.2 确认"无变化不构建"

手动再触发一次 Sync（mode 任意），预期输出 `数据无变化，跳过提交与部署`，不产生新 commit。

### 5.3 确认定时任务已排程

仓库 → **Actions** → **Sync Plugins** → 右侧 **Schedule** 区域，预期显示 4 个 cron（北京时间 08:18 全量 + 14:18 / 20:18 / 02:18 增量）。Actions 定时任务默认启用。

---

## 阶段 6：验收与安全（约 10 分钟）

按 [FIRST_DEPLOY_CHECKLIST.md](./FIRST_DEPLOY_CHECKLIST.md) 第三~六阶段逐项验收：
- API 8 项 + ETag 304 + CORS + MCP
- 静态资源 /feed.xml /openapi.json /catalog/plugins.json
- WAF Rate Limiting 规则（免费 1 条）
- Bot Fight Mode
- Monitor 每小时运行

---

## 阶段 7：全部完成后系统自动运行

| 时刻 | 自动动作 |
|---|---|
| 每日 08:18 | 全量同步 → 有变化则 commit → 自动部署 |
| 每日 14:18 / 20:18 / 02:18 | 增量同步 → 有变化则 commit → 自动部署 |
| 每小时第 5 分钟 | Monitor 健康检查 + 数据新鲜度检查 |
| 任何时刻 | 你可用 `repository_dispatch` 一条 curl 立即触发全量刷新 |

**日常维护 = 0 操作**。唯一要做的是：插件作者给仓库加 `dsh-plugin` topic 后，下次同步自动收录；或你想下架/改名，编辑 `catalog/overrides.json` 后等下次同步。

---

## 附：一句话速查

```bash
# 本地开发预览
npm run sync && npm run site:dev

# 手动触发云端全量刷新（任意系统）
curl -X POST \
  -H "Authorization: Bearer <你的PAT>" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/<你>/dsh-hub/dispatches \
  -d '{"event_type":"sync-plugins","client_payload":{"mode":"full"}}'

# 查看部署状态
# GitHub Actions → Deploy；或 https://dash.cloudflare.com → Workers & Pages → dsh-hub
```
