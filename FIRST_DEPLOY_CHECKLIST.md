# DSH Plugins Nav — 首次部署验收步骤

> 目标：把本仓库从「代码就绪」推进到「全自动运行的线上站点」。
> 完整方案见 [DEPLOYMENT_V2.md](./DEPLOYMENT_V2.md)，本文件是逐项可勾选的验收清单（含每个步骤的预期结果与验证命令）。
> 预计总耗时：40~60 分钟。

---

## 〇、前提

- [ ] 已阅读 [DEPLOY_GUIDE.md](./DEPLOY_GUIDE.md) 完成从零到线上的部署
- [ ] GitHub 仓库为**公开**仓库（Actions 分钟数无上限的前提）
- [ ] Cloudflare 账号可用（免费）
- [ ] 本地 Node.js ≥ 20

---

## 一、代码就绪检查（本地，约 10 分钟）

**1.1 仓库无残留测试数据**

当前 `catalog/plugins.json` 可能仍是本地测试数据（5 个模拟插件）。运行真实全量同步覆盖：

```bash
npm ci
npm run sync            # 全量同步（需要网络，抓取 topic:dsh-plugin 真实数据）
```

预期：
- 日志出现 `全量模式：搜索全部 topic:dsh-plugin 仓库`
- 结束行 `完成：N 个插件`（N 为真实数量，通常数十~数百）
- `catalog/plugins.json` 的 `meta.count` 与 `meta.stats.total` 一致

> 说明：若不执行此步，首次 GitHub Actions 同步也会自动覆盖，但本地先跑可提前暴露网络/配额问题。

**1.2 数据校验通过**

```bash
node scripts/validate.mjs
```

预期输出：`✅ 校验通过：N 个插件，meta.etag=xxxx`

**1.3 本地构建成功**

```bash
node scripts/copy-assets.mjs && cd site && npm ci && npm run build
```

预期：
- `✅ 拷贝 plugins.json / meta.json / feed.xml`
- `9 page(s) built`，且 `site/dist/catalog/plugins.json`、`site/dist/feed.xml`、`site/dist/openapi.json` 存在

**1.4 本地 API 冒烟（可选但推荐）**

```bash
cd .. && npx wrangler pages dev site/dist --port 8788
# 另开终端
curl http://127.0.0.1:8788/api/v1/health
```

预期：`{"status":"ok","version":2,"updated_at":"...","count":N,"source":"static"}`

**1.5 提交代码**

```bash
git add -A && git commit -m "feat: v2 全自动插件导航 (方案C + 真API)"
git push origin main
```

预期：push 后 GitHub Actions 自动触发 `Deploy` 工作流（首次会构建并部署）。

---

## 二、Cloudflare 接入（约 10 分钟）

**2.1 创建 Pages 项目（Direct Upload）**

1. Cloudflare 控制台 → **Workers & Pages** → **Create** → **Pages** → 选 **Upload assets**（不是 Connect to Git）
2. 项目名：`dsh-hub`
3. 其余保持默认，直接创建（后续由 Action 上传构建产物）

> ⚠️ 不要连接 Git 仓库、不要配置 Framework/Build command，否则与 GitHub Actions 双重触发构建。

**2.2 创建 API Token**

Cloudflare → 右上头像 → **My Profile** → **API Tokens** → **Create Token** → 选模板 **Edit Cloudflare Workers**（含 Pages 权限），或自定义权限：
- `Account - Cloudflare Pages - Edit`

保存生成的 Token（只显示一次）。

**2.3 配置 GitHub Secrets & Variables**

仓库 → **Settings** → **Secrets and variables** → **Actions**：

| 类型 | 名称 | 值 |
|---|---|---|
| Secrets | `CLOUDFLARE_API_TOKEN` | 步骤 2.2 生成的 Token |
| Secrets | `CLOUDFLARE_ACCOUNT_ID` | CF 控制台右侧栏的 Account ID |
| Variables | `SITE_URL` | `https://dsh-hub.pages.dev` |

---

## 三、首次部署与站点验收（约 15 分钟）

**3.1 手动触发部署**

仓库 → **Actions** → **Deploy** → **Run workflow**。

预期：
- Job 各步骤绿色（Checkout → Install → Copy → Build → Deploy）
- 若失败，看红叉步骤；最常见原因：`CLOUDFLARE_ACCOUNT_ID` 填错、项目名不一致。

**3.2 首页验收**

浏览器访问 `https://dsh-hub.pages.dev`：

- [ ] 显示插件卡片网格、搜索框、分类筛选
- [ ] 有数据（非「收录 0 个」）
- [ ] 点击卡片进入详情页
- [ ] 详情页有安装命令、**复制按钮**可用
- [ ] `/docs` API 文档页、`/stats` 统计页、404 页可访问

**3.3 静态资源验收**

| 路径 | 预期 |
|---|---|
| `/catalog/plugins.json` | 完整 JSON（跨域可读） |
| `/feed.xml` | RSS XML |
| `/openapi.json` | OpenAPI 3.0 规范 |
| `/sitemap-index.xml` | sitemap |
| `/robots.txt` | robots 规则 |
| `/favicon.svg` | 图标 |

**3.4 API 验收（重点）**

```bash
BASE=https://dsh-hub.pages.dev

# 1) 健康检查
curl -s $BASE/api/v1/health
# 预期 {"status":"ok",...,"count":N,"source":"static"}

# 2) 列表 + 分页
curl -s "$BASE/api/v1/plugins?per_page=10"
# 预期含 pagination 字段；total_pages 正确

# 3) 过滤（分类）
curl -s "$BASE/api/v1/plugins?category=mcp"
# 预期仅返回 mcp 分类

# 4) 搜索
curl -s "$BASE/api/v1/search?q=xxx"
# 预期 total>0（换一个真实关键词）

# 5) 详情
curl -s "$BASE/api/v1/plugins/<某slug>"
# 预期返回 plugin 对象 + related

# 6) 分类 / 统计
curl -s $BASE/api/v1/categories
curl -s $BASE/api/v1/stats
# 预期数据合理

# 7) ETag 协商缓存
curl -s -D - -o /dev/null $BASE/api/v1/plugins | grep -i etag
# 记录 ETag 值，然后：
curl -s -o /dev/null -w "%{http_code}\n" -H "If-None-Match: <ETag>" $BASE/api/v1/plugins
# 预期第二次返回 304

# 8) 404 错误格式
curl -s $BASE/api/v1/plugins/nonexistent-xyz
# 预期 {"error":{"code":404,"message":"plugin not found: ..."}}
```

**3.5 CORS 验收**

从任意其他域名页面（如 `https://example.com` 的开发者工具 Console）执行：

```js
fetch('https://dsh-hub.pages.dev/api/v1/health').then(r => r.json()).then(console.log)
```

预期：无跨域报错，正常返回。跨域的关键响应头为 `Access-Control-Allow-Origin: *`。

**3.6 MCP 验收**

```bash
curl -s -X POST $BASE/api/v1/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

预期：返回 `tools` 数组（list_plugins / get_plugin / list_categories / search_plugins）。

---

## 四、自动化链路验收（约 10 分钟 + 观察）

**4.1 手动触发一次全量同步**

仓库 → **Actions** → **Sync Plugins** → **Run workflow**（mode=full）。

预期链路：
1. Sync 工作流绿色，输出 `完成：N 个插件`
2. **自动产生 commit** `chore(sync): 更新插件目录 (N 个插件, full)`
3. 该 push 自动触发 **Deploy** 工作流
4. 再次访问站点，数据已更新（`/api/v1/meta` 的 `updated_at` 变化）

> ⚠️ 若 commit 后 Deploy 未触发，检查 sync.yml 提交**未包含** `[skip ci]`（V2 已修复此问题）。

**4.2 验证「无变化不构建」**

对同一份数据再跑一次 `workflow_dispatch`（或等下次定时）：

- 预期：Sync 工作流输出 `数据无变化，跳过提交与部署`，**不产生**新 commit。

**4.3 数据新鲜度**

```bash
curl -s $BASE/api/v1/meta | python -c "import sys,json;print(json.load(sys.stdin)['updated_at'])"
```

预期：时间在最近 36 小时内（否则 monitor 会告警）。

---

## 五、监控与告警验收（约 5 分钟）

**5.1 确认监控工作流存在**

仓库 → **Actions** → **Monitor**。预期每小时执行一次、绿色。

**5.2 邮件告警链路（可选验证）**

- 仓库 → **Settings** → **Notifications** → 确认 **Actions** 通知为「All activity」（或订阅该仓库的 workflow 通知）。
- 故障演练（可选）：临时停掉一个端点，确认收到失败邮件后恢复。不演练也可，机制与 Actions 失败通知相同。

**5.3 README 徽章**

- [ ] 确认 README 顶部 3 个 Actions 徽章显示绿色（首次需等至少一次运行后刷新）。

---

## 六、安全加固（约 5 分钟）

**6.1 Rate Limiting 规则（免费 1 条）**

Cloudflare 控制台 → 对应域名的 **Security → WAF → Rate limiting rules** → Create rule：

```
规则名: api-protect
匹配: URI Path 以 /api/ 开头
速率: 每 10 秒 20 个请求（按 IP）
动作: Block 60 秒
```

**6.2 Bot Fight Mode**

Cloudflare → **Security → Bots** → 开启 **Bot Fight Mode**（免费）。

**6.3 确认 HTTPS**

Pages 默认强制 HTTPS，确认地址栏为 https 且无告警。

---

## 七、可选增强（按需）

- [ ] 绑定自定义域名：`DEPLOYMENT_V2.md` §14（DNS 迁入 CF → Custom domains → 更新 `astro.config.mjs` 的 `site` 与 `SITE_URL`）
- [ ] 提交 sitemap 到搜索引擎（Bing Webmaster 等）
- [ ] 在 README 补充真实站点链接

---

## 八、验收完成判定

勾选以下**全部**即视为首次部署验收通过：

- [ ] 首页有真实数据（非 0 个）
- [ ] `/api/v1/health` 返回 ok
- [ ] `/api/v1/plugins` 分页/过滤/搜索可用
- [ ] ETag 协商返回 304
- [ ] CORS 跨域可访问
- [ ] MCP tools/list 正常
- [ ] `/feed.xml`、`/openapi.json`、`/catalog/plugins.json` 可访问
- [ ] 手动 Sync 后自动触发 Deploy，站点数据更新
- [ ] 数据无变化时不产生新 commit
- [ ] Monitor 每小时运行且绿色
- [ ] Rate Limiting 规则已配置

---

> 有问题时参考 [DEPLOYMENT_V2.md](./DEPLOYMENT_V2.md) §15 故障排查表，或查看对应 Actions 工作流日志。
