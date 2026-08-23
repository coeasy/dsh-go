// GET /api/v1/categories —— 分类注册表（含计数）
import { loadCatalog, json, internalError, type Env } from '../../_lib';

const CATEGORY_ZH: Record<string, string> = {
  'web-ui': 'Web UI 组件',
  desktop: '桌面端',
  mcp: 'MCP 工具',
  skills: '技能 (Skills)',
  theme: '主题',
  terminal: '终端工具',
  coding: '编码辅助',
  agent: 'Agent 工作流',
  vision: '视觉 / 多模态',
  memory: '记忆 / 存储',
  security: '安全',
  integration: '集成',
  tool: '通用工具',
  other: '其他',
};

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const { data, etag } = await loadCatalog(env);
    const byCategory = data.meta.stats.by_category || {};

    const categories = Object.entries(byCategory)
      .map(([id, count]) => ({
        id,
        name: id,
        name_zh: CATEGORY_ZH[id] || id,
        count,
      }))
      .sort((a, b) => b.count - a.count);

    return json(
      { categories, total: data.meta.count, meta: { updated_at: data.meta.updated_at } },
      { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' } },
      etag
    );
  } catch (e) {
    return internalError(e);
  }
};
