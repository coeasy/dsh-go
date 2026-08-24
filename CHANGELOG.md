# Changelog

## [2.3.0] - 2026-08-24

### 新功能
- 新增 **趋势 / 热门榜** 页面 `/trending`：按 `trend_score`（综合 Star、增速与更新频率）排名 TOP100，榜单前 3 高亮，卡片可跳详情/仓库
- 详情页新增**完整 README 渲染**：客户端从 `raw.githubusercontent.com/{repo}/HEAD/README.md` 拉取并轻量渲染（安全转义 + 标题/列表/代码块/引用/链接/表格），无需侵入构建，离线或加载失败自动回退到“去 GitHub 查看”
- 详情页新增 **Markdown 徽章**：一键复制 shields.io 风格徽章链接，方便在 README / 博客中引用回跳
- 首页新增**语言索引筛选**：根据数据统计 Top9 语言一键筛选，与其它筛选/排序可叠加，URL 参数同步
- **README 最近热门推荐表**：自动生成 DSH 原生插件（仅收录命名含 `dsh` / `deepseek-harness`，剔除仅打 `dsh-plugin` 标签但无关的老开源项目）的最近更新 Top20 表格，每次同步后由 CI 重写，始终展示最新（1000-3000★ 强相关候选过少，门槛放宽至 500★ 以凑满 20）
- 首页 hero 新增**数据更新时间**信息条（中英双语）

### 修复
- 修复**多语言切换失效**根因：`initI18n()` 被 Layout 打包脚本与模块自动执行块**各调用一次**，导致语言/主题按钮挂载双份 click 监听，点击一次被连续切换两次（看起来像“点了没反应”）。现加入幂等守卫，仅挂载一次监听
- 修复插件卡片一键复制按钮图标被 i18n 覆盖：图标 `⬇` 不再被替换为标签文本，改为 `data-i18n-aria` 翻译无障碍标签

### 体验
- 导航新增“趋势”入口；详情页 star/forks/issues/watchers 统计标签接入双语 i18n
- 双语词典补全：趋势榜、徽章、README 加载/失败、语言筛选等词条（`tr_*` / `badge_*` / `readme_*` / `f_language` / `stat_*`）
- 404 页接入双语 i18n；补充 `guide` / `notfound_*` 词条，全站 aria-label 不再退化为字面量
- 清理 lint：移除 `sync.mjs` 未使用变量/函数，`app.js` 空 catch 块补注释

## [2.2.0] - 2026-08-24

### 扩充收录 + 质量优化
- 同步引擎支持**多主题并集抓取**：保留主源 `topic:dsh-plugin`，新增补充主题 `topic:deepseek-harness`（仅收录确切带 `dsh-plugin.json` 的插件，自动过滤非插件项目）
- 全量与增量模式均遍历补充主题；主源优先去重，补充源重复项不覆盖主源
- 分类识别增强：新增 `web-ui`（dashboard/webapp/frontend）、`agent`（multi-agent/coding-agent）、`desktop`（desktop-pet）、`integration`（token-usage/cost-tracking/billing）等规则，降低 `other` 占比

### 界面
- 插件卡片新增一键复制安装命令按钮（⬇），覆盖 4578+ 插件，含剪贴板不可用时降级
- 首页新增"三步安装引导"区块（查找→复制→终端运行，中英双语）

### PWA 与多位置部署
- 新增 `manifest.webmanifest`（相对路径 `start_url`/`scope`，兼容根路径与子路径部署）
- Layout 补充 `manifest` / `theme-color` / `apple-touch-icon` / `robots` 标签
- `deploy-mirror.yml` 的 `GITEE_REPO` 改为 Repository Variables 可配置

### 文档
- README 精简对外展示（部署仅保留简洁入口，API 引导指向站内 `/docs`）
- 部署方案文档（DEPLOYMENT_V2 / DEPLOY_GUIDE / FIRST_DEPLOY_CHECKLIST / DEPLOYMENT）头部统一标注"内部运维文档"，不对外分发
- 品牌统一对齐为 DSH Go

## [2.1.1] - 2026-08-23

### 双端部署
- 新增 GitHub Pages 静态镜像部署（`deploy-pages.yml`）：Cloudflare Pages（全功能含 API）+ GitHub Pages（纯静态展示）
- 新增 `PUBLIC_API_URL` 环境变量分离 API 域名：GitHub Pages 上所有 `/api/*` 链接自动跳转 Cloudflare 主站
- `urls.ts` 新增 `apiUrl()` / `apiBase()`；`u()` 支持子路径 base 前缀
- README / DEPLOYMENT_V2 / DEPLOY_GUIDE 补充双部署架构与 coeasy 配置步骤

## [2.1.0] - 2026-08-23

### 更名
- 项目名由 `dsh-plugins-nav` 更改为 **`dsh-hub`**（体现“插件中心”定位，替代“导航站”语义）
- 同步更新：GitHub 仓库名、Cloudflare 项目名/域名 `dsh-hub.pages.dev`、代码、配置与全部文档（80 处替换）

## [2.0.0] - 2026-08-23

### 架构（方案 C）
- 数据层与计算层分离：静态 catalog + Pages Functions 动态 API，保留 KV 升级路径
- 绝对 0 元：静态无限量 + Functions 免费 10 万次/天（超量只停服不扣费）+ 公开仓库 Actions 无限

### 新功能
- **真·RESTful API v1**（10 个端点）：列表/详情/分类/统计/搜索/元信息/健康检查/MCP，过滤/分页/ETag 304/CORS
- **MCP 端点** `/api/v1/mcp`：AI Agent 通过 JSON-RPC 查询插件目录
- **增量同步**：每 6 小时只抓 `pushed:` 变更仓库，新插件最快 6 小时内上架
- **内容级 diff**：数据无变化不写盘、不提交、不构建
- **自监控**：monitor.yml 每小时健康检查 + 数据新鲜度检查，失败自动邮件
- **外部触发**：`repository_dispatch` 一条 curl 立即全量刷新
- **OpenAPI 3.0** 规范、站内 API 文档页、统计页、404 页、RSS

### 修复（相对 V1）
- 移除 `[skip ci]`，修复"数据更新后永不部署"的致命问题
- API 由静态文件改为真正的边缘函数，URL 参数不再静默失效
- 修复首页按 updated 排序逻辑

### 前端
- Astro 5 + sitemap 集成
- 首页搜索/筛选/排序全部同步到 URL 参数（可分享）
- 详情页增加安装命令复制、README 摘要、相关推荐
- SearchBar / CategoryFilter 独立组件化（原内联实现）

### 人工覆盖层
- 新增 `catalog/overrides.json`：名称/描述/分类/标签/主页/隐藏（hidden）人工覆盖，优先级最高

### 部署验收
- 新增 [FIRST_DEPLOY_CHECKLIST.md](./FIRST_DEPLOY_CHECKLIST.md) 首次部署逐项验收步骤
- README 部署方式修正为 **Direct Upload + Actions 部署**（消除与 CF 直连 Git 的双重构建歧义）

## [1.0.0] - 2026-08-21

- 初版：静态站 + 静态 JSON"API" + 每日全量同步（见 DEPLOYMENT.md 归档）
