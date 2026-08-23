# Changelog

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
