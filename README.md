# DSH Go

DeepSeek Harness 插件市场导航站 —— 全自动同步、真·RESTful API、绝对 0 元部署。

[![Deploy](https://github.com/coeasy/dsh_go/actions/workflows/deploy.yml/badge.svg)](https://github.com/coeasy/dsh_go/actions/workflows/deploy.yml)
[![Sync](https://github.com/coeasy/dsh_go/actions/workflows/sync.yml/badge.svg)](https://github.com/coeasy/dsh_go/actions/workflows/sync.yml)
[![Monitor](https://github.com/coeasy/dsh_go/actions/workflows/monitor.yml/badge.svg)](https://github.com/coeasy/dsh_go/actions/workflows/monitor.yml)
[![Pages](https://github.com/coeasy/dsh_go/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/coeasy/dsh_go/actions/workflows/deploy-pages.yml)

## 特性

- **全自动更新**：每日 08:18 全量同步 + 每 6 小时增量同步（GitHub topic:`dsh-plugin`）
- **真·动态 API**：`/api/v1/*`（Cloudflare Pages Functions），过滤/搜索/排序/分页/ETag 304
- **MCP 端点**：`/api/v1/mcp`，AI Agent 直接查询插件目录
- **双端部署**：Cloudflare Pages（全功能，含 API）+ GitHub Pages（静态镜像，无 API）
- **零成本**：静态无限量 + Functions 免费 10 万次/天（超量只停服不扣费）+ 公开仓库 Actions 无限
- **自助监控**：每小时健康检查 + GitHub 原生邮件告警

## 快速开始

### 1. 部署到 Cloudflare Pages

> 本项目采用 **Direct Upload 方式**：构建在 GitHub Actions 完成，`deploy.yml` 通过 `cloudflare/pages-action` 上传 `site/dist`。**不要在 CF 控制台连接 Git 仓库或配置构建命令**，否则会与 Action 双重触发构建。

1. 将本仓库设为公开；
2. Cloudflare 控制台 → Workers & Pages → Create → Pages → **Upload assets**（Direct Upload），项目名 `dsh-go`（无需指定框架/构建命令）；
3. 在 GitHub 仓库 Settings → Secrets and variables → Actions 添加：
   - `CLOUDFLARE_API_TOKEN`（CF API Token，权限：Account - Cloudflare Pages - Edit）
   - `CLOUDFLARE_ACCOUNT_ID`
4. 在 Variables 添加 `SITE_URL = https://dsh-go.pages.dev`；
5. 手动触发一次 `Deploy` 工作流，首次部署后访问 `https://dsh-go.pages.dev`。

从零到线上的完整操作流程见 [DEPLOY_GUIDE.md](./DEPLOY_GUIDE.md)；部署后的逐项验收见 [FIRST_DEPLOY_CHECKLIST.md](./FIRST_DEPLOY_CHECKLIST.md)。

### 1.5 同时部署到 GitHub Pages（静态镜像，可选）

> `deploy-pages.yml` 会把站点构建为纯静态产物，通过 GitHub 官方 Actions 部署到 `https://coeasy.github.io/dsh_go/`。
> GitHub Pages **不提供 functions**，因此镜像站上 `/api/v1/*` 不可用（前端均为静态渲染，不调用 API，功能不受影响；页面上指向 API 的链接会自动跳转到 Cloudflare 主站）。

1. 仓库 Settings → Pages → **Build and deployment → Source** 选择 **GitHub Actions**；
2. 仓库 Settings → Actions → Workflow permissions 选择 **Read and write**（`GITHUB_TOKEN` 自动获得 Pages 写入权限）；
3. 在 Variables 添加 `CF_PAGES_PROJECT = dsh-go`（用于镜像站把 API 链接指回 Cloudflare 主站）；若不设置，默认 `https://dsh-go.pages.dev`；
4. 推送 `main` 分支（或手动触发 `Deploy GitHub Pages`）即可。访问 `https://coeasy.github.io/dsh_go/`。

> 首次启用 GitHub Pages 后，需在 GitHub 账号层面确认该仓库已执行一次 Pages 部署（触发 `actions/upload-pages-artifact` + `deploy-pages`）。
> 若你希望迁移到组织账号，把仓库移动到组织后，上述 `coeasy` 域名自动变为 `<组织>.github.io`，API 域名保持不变。

### 2. 本地开发

```bash
npm ci                    # 根依赖（wrangler / sync 脚本）
npm run sync              # 首次全量同步（可选，便于本地预览）
cd site && npm ci         # 前端依赖
npm run site:dev          # 启动本地开发服务器
```

### 3. 开放 API 速查

| 端点 | 说明 |
|---|---|
| `GET /api/v1/plugins` | 插件列表（`?category=&verified=&search=&sort=&page=&per_page=`） |
| `GET /api/v1/plugins/:slug` | 插件详情 |
| `GET /api/v1/search?q=` | 关键词搜索 |
| `GET /api/v1/categories` | 分类 + 计数 |
| `GET /api/v1/stats` | 统计 + Top 榜单 |
| `GET /api/v1/meta` | 数据更新时间 |
| `GET /api/v1/health` | 健康检查 |
| `POST /api/v1/mcp` | MCP（AI Agent） |
| `GET /catalog/plugins.json` | 原始全量数据 |
| `GET /feed.xml` | RSS |

详细文档见 [DEPLOYMENT_V2.md](./DEPLOYMENT_V2.md) 与站内 `/docs`。

## 如何收录你的插件

给你的 GitHub 仓库添加 `dsh-plugin` topic，下一次每日同步（或手动触发）后自动收录。

## 提交新插件（人工）

Fork 后编辑 `catalog/overrides.json`（可选字段覆盖）并发 PR；或直接开 Issue，说明仓库地址。

## 许可证

MIT（数据来源 GitHub 公开仓库）。
