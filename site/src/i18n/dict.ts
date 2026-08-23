// site/src/i18n/dict.ts —— 全站中英文词典（被 Layout 客户端脚本与单测共享）
export type Lang = 'zh' | 'en';

export const I18N: Record<Lang, Record<string, string>> = {
  zh: {
    nav_home: '首页', nav_docs: 'API 文档', nav_stats: '统计', nav_rss: 'RSS',
    footer: 'DSH Plugins Nav · 数据每日自动同步自 GitHub topic:dsh-plugin · <a href="{api}">API 状态</a>',
    hero_title: 'DeepSeek Harness 插件市场',
    hero_sub: '收录 {n} 个 dsh-plugin 插件，每日自动更新 · 全开源 · 开放 API',
    empty_msg: '没有匹配的插件，换个关键词试试？',
    search_ph: '搜索插件名称 / 描述 / 标签…',
    f_all: '全部', f_verified: '已验证', f_new: '新上架',
    s_stars: '最多 Star', s_trend: '热度', s_updated: '最近更新', s_created: '最新发布',
    cat_webui: 'Web UI', cat_desktop: '桌面端', cat_mcp: 'MCP', cat_skills: '技能',
    cat_theme: '主题', cat_terminal: '终端', cat_coding: '编码', cat_agent: 'Agent',
    cat_vision: '视觉', cat_memory: '记忆', cat_security: '安全', cat_integration: '集成',
    cat_tool: '工具', cat_other: '其他',
    doc_title: 'API 文档', doc_intro: '公开、免费、CORS 全开、无需认证，支持 If-None-Match ETag 协商缓存。数据每日 08:18 自动同步。',
    doc_basics: '基础信息', doc_baseurl: 'Base URL: {b}', doc_openapi: '规范文件：/openapi.json（可导入 Postman / Apifox）',
    doc_fresh: '数据新鲜度：<a href="{api_url}/api/v1/meta">{api_url}/api/v1/meta</a>', doc_ratelimit: '速率限制：每 IP 每 10 秒 20 次（Cloudflare WAF 免费规则）',
    doc_endpoints: '端点一览', th_method: '方法', th_path: '路径', th_desc: '说明', th_param: '参数', th_desc2: '说明',
    doc_params: '常用参数（/api/v1/plugins）', doc_examples: '调用示例', doc_resp: '响应格式',
    doc_resp_text: '列表端点返回 { meta, pagination, plugins }；详情返回 { plugin, related, meta }；错误统一为 { error: { code, message } }。',
    doc_data: '数据下载与订阅', doc_raw: '原始全量数据：/catalog/plugins.json', doc_rss: 'RSS 订阅：/feed.xml',
    doc_mcp: 'MCP 接入（Claude Desktop）', doc_mcp_text: '在 Claude Desktop 配置文件中添加以下 MCP Server，即可让 Claude 直接查询 DSH 插件目录：',
    doc_etag: '带 ETag 的增量轮询（节省流量）', doc_etag_text: '客户端缓存 ETag，下次请求带 If-None-Match，数据未变时服务器返回 304 而不传输任何内容。',
    stats_title: '统计', stat_total: '插件总数', stat_verified: '已验证', stat_rate: '验证率', stat_langs: '使用语言数',
    stats_cat: '分类分布', stats_lang: '语言分布 Top 10', stats_lic: '许可证分布',
    stats_updated: '数据更新于 {t}',
    pl_back: '← 返回首页', pl_install: '安装', pl_copy: '复制', pl_copied: '已复制 ✓',
    pl_info: '信息', pl_repo: '仓库', pl_language: '语言', pl_license: '许可证', pl_listed: '收录时间',
    pl_updated: '最近更新', pl_homepage: '主页', pl_about: '简介', pl_related: '相关推荐',
    pl_new: '新上架', pl_verified: '✓ verified', pl_quick: '一键安装', pl_linux: 'Linux / macOS 脚本',
    pl_win: 'Windows 脚本', pl_open_dsh: '用 DSH 打开',
  },
  en: {
    nav_home: 'Home', nav_docs: 'API Docs', nav_stats: 'Stats', nav_rss: 'RSS',
    footer: 'DSH Plugins Nav · Synced daily from GitHub topic:dsh-plugin · <a href="{api}">API Status</a>',
    hero_title: 'DeepSeek Harness Plugin Hub',
    hero_sub: 'Browse {n} dsh-plugin plugins, synced daily · open source · open API',
    empty_msg: 'No matching plugins, try another keyword.',
    search_ph: 'Search name / description / tags…',
    f_all: 'All', f_verified: 'Verified', f_new: 'New',
    s_stars: 'Most Stars', s_trend: 'Trending', s_updated: 'Recently Updated', s_created: 'Newest',
    cat_webui: 'Web UI', cat_desktop: 'Desktop', cat_mcp: 'MCP', cat_skills: 'Skills',
    cat_theme: 'Theme', cat_terminal: 'Terminal', cat_coding: 'Coding', cat_agent: 'Agent',
    cat_vision: 'Vision', cat_memory: 'Memory', cat_security: 'Security', cat_integration: 'Integration',
    cat_tool: 'Tools', cat_other: 'Other',
    doc_title: 'API Docs', doc_intro: 'Public, free, CORS-enabled, no auth. Supports If-None-Match ETag negotiation. Synced daily at 08:18.',
    doc_basics: 'Basics', doc_baseurl: 'Base URL: {b}', doc_openapi: 'Spec: /openapi.json (import to Postman / Apifox)',
    doc_fresh: 'Freshness: <a href="{api_url}/api/v1/meta">{api_url}/api/v1/meta</a>', doc_ratelimit: 'Rate limit: 20 req / 10s / IP (Cloudflare WAF free rule)',
    doc_endpoints: 'Endpoints', th_method: 'Method', th_path: 'Path', th_desc: 'Description', th_param: 'Param', th_desc2: 'Description',
    doc_params: 'Common params (/api/v1/plugins)', doc_examples: 'Examples', doc_resp: 'Response Format',
    doc_resp_text: 'List returns { meta, pagination, plugins }; detail returns { plugin, related, meta }; errors are { error: { code, message } }.',
    doc_data: 'Data & Feeds', doc_raw: 'Raw data: /catalog/plugins.json', doc_rss: 'RSS feed: /feed.xml',
    doc_mcp: 'MCP (Claude Desktop)', doc_mcp_text: 'Add the following MCP Server to your Claude Desktop config to let Claude query the DSH catalog directly:',
    doc_etag: 'ETag polling (save bandwidth)', doc_etag_text: 'Cache the ETag; send If-None-Match next time. If unchanged, the server returns 304 with no body.',
    stats_title: 'Stats', stat_total: 'Total plugins', stat_verified: 'Verified', stat_rate: 'Verified %', stat_langs: 'Languages',
    stats_cat: 'By Category', stats_lang: 'Top 10 Languages', stats_lic: 'By License',
    stats_updated: 'Updated at {t}',
    pl_back: '← Back', pl_install: 'Install', pl_copy: 'Copy', pl_copied: 'Copied ✓',
    pl_info: 'Info', pl_repo: 'Repo', pl_language: 'Language', pl_license: 'License', pl_listed: 'Listed',
    pl_updated: 'Updated', pl_homepage: 'Homepage', pl_about: 'About', pl_related: 'Related',
    pl_new: 'New', pl_verified: '✓ verified', pl_quick: 'Quick Install', pl_linux: 'Linux / macOS script',
    pl_win: 'Windows script', pl_open_dsh: 'Open with DSH',
  },
};

// 分类 id → i18n key 映射（data-i18n-cat 使用）
export const CAT: Record<string, string> = {
  'web-ui': 'cat_webui', 'desktop': 'cat_desktop', 'mcp': 'cat_mcp', 'skills': 'cat_skills',
  'theme': 'cat_theme', 'terminal': 'cat_terminal', 'coding': 'cat_coding', 'agent': 'cat_agent',
  'vision': 'cat_vision', 'memory': 'cat_memory', 'security': 'cat_security', 'integration': 'cat_integration',
  'tool': 'cat_tool', 'other': 'cat_other',
};

export function tr(key: string, lang: Lang, ctx?: Record<string, string | number>): string {
  const table = I18N[lang] || I18N.zh;
  const tpl = table[key] || I18N.zh[key] || key;
  if (!ctx) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (_m, k: string) => (ctx[k] != null ? String(ctx[k]) : ''));
}
