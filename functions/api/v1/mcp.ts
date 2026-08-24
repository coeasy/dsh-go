// POST /api/v1/mcp —— MCP 端点（AI Agent 通过 JSON-RPC 2.0 查询插件目录）
// 工具：list_plugins / get_plugin / list_categories / search_plugins
import { loadCatalog, filterPlugins, json, error, type Env } from '../../_lib';

interface McpArgs {
  category?: string;
  search?: string;
  verified?: boolean;
  sort?: string;
  limit?: number;
  slug?: string;
  q?: string;
}

interface JsonRpcBody {
  id?: unknown;
  method?: string;
  params?: { name?: string; arguments?: McpArgs };
}

const TOOLS = [
  {
    name: 'list_plugins',
    description: '列出 DSH 插件，可按分类/关键词/排序/分页过滤',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: '分类 id，如 web-ui' },
        search: { type: 'string', description: '关键词搜索' },
        verified: { type: 'boolean', description: '仅含已验证插件' },
        sort: { type: 'string', enum: ['stars', 'trend', 'updated', 'created', 'name'], default: 'stars' },
        limit: { type: 'number', default: 20 },
      },
    },
  },
  {
    name: 'get_plugin',
    description: '获取单个插件详情（含 README 摘要与安装命令）',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string', description: '插件 slug，如 owner-repo' } },
      required: ['slug'],
    },
  },
  {
    name: 'list_categories',
    description: '列出所有插件分类及数量',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'search_plugins',
    description: '关键词搜索插件',
    inputSchema: {
      type: 'object',
      properties: { q: { type: 'string', description: '搜索关键词' }, limit: { type: 'number', default: 10 } },
      required: ['q'],
    },
  },
];

function rpcResult(id: unknown, result: unknown) {
  return json({ jsonrpc: '2.0', id, result });
}
function rpcError(id: unknown, code: number, message: string) {
  return json({ jsonrpc: '2.0', id, error: { code, message } }, { status: 400 });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // 请求体大小上限，防止超大 payload 拖垮无状态 Functions
  const len = Number(request.headers.get('content-length'));
  if (Number.isFinite(len) && len > 1_000_000) return error(413, 'payload too large');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(400, 'invalid JSON body');
  }
  const parsed = body as JsonRpcBody | null;
  const id = parsed?.id;
  const method = parsed?.method;
  const params = parsed?.params;
  if (!method) return error(400, 'missing method');

  try {
    const { data } = await loadCatalog(env);
    const plugins = data.plugins;

    if (method === 'initialize') {
      return rpcResult(id, {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'dsh-go', version: '2.0.0' },
      });
    }

    if (method === 'tools/list') {
      return rpcResult(id, { tools: TOOLS });
    }

    if (method === 'tools/call') {
      const { name, arguments: args } = params || {};
      let result: unknown;

      switch (name) {
        case 'list_plugins': {
          const q = {
            category: args?.category,
            search: args?.search,
            verified: args?.verified === true,
            sort: args?.sort || 'stars',
          };
          const limit = Math.max(1, Math.min(Number(args?.limit) || 20, 100));
          const list = filterPlugins(plugins, q).slice(0, limit);
          result = list.map((p) => ({
            slug: p.slug, name: p.name, category: p.category, stars: p.stars,
            description: p.description, install: p.install_cmd, verified: p.verified,
          }));
          break;
        }
        case 'get_plugin': {
          const p = plugins.find((x) => x.slug === args?.slug);
          result = p || null;
          break;
        }
        case 'list_categories': {
          result = data.meta.stats.by_category;
          break;
        }
        case 'search_plugins': {
          const kw = (args?.q || '').toLowerCase();
          const limit = Math.max(1, Math.min(Number(args?.limit) || 10, 100));
          const list = plugins
            .filter((p) =>
              p.name.toLowerCase().includes(kw) ||
              p.description.toLowerCase().includes(kw) ||
              p.topics.some((t) => t.includes(kw)) ||
              p.full_name.toLowerCase().includes(kw)
            )
            .sort((a, b) => b.stars - a.stars)
            .slice(0, limit);
          result = list.map((p) => ({ slug: p.slug, name: p.name, stars: p.stars, description: p.description }));
          break;
        }
        default:
          return rpcError(id, -32601, `unknown tool: ${name}`);
      }

      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
    }

    if (method === 'notifications/initialized') {
      return new Response(null, { status: 202 });
    }

    return rpcError(id, -32601, `unsupported method: ${method}`);
  } catch (e) {
    // JSON-RPC 内部错误：完整日志给运维，客户端只收通用信息
    console.error('[dsh-go] mcp internal error:', e);
    return rpcError(id, -32603, 'internal error');
  }
};

// GET 返回端点说明（供人工/浏览器探查）
export const onRequestGet: PagesFunction = async () =>
  json({
    name: 'DSH Go MCP',
    description: 'JSON-RPC 2.0 over HTTP。用 POST + Content-Type: application/json 调用 initialize / tools/list / tools/call',
    tools: TOOLS.map((t) => t.name),
  });

// 浏览器跨域 POST 会先发 OPTIONS 预检，必须返回 CORS 头，否则浏览器侧 MCP 客户端不可用
export const onRequestOptions: PagesFunction = async () =>
  json(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
      'Access-Control-Max-Age': '86400',
    },
  });
