// POST /api/v1/mcp — read-only MCP endpoint for catalog and Registry V3 discovery.
import { loadCatalog, filterPlugins, json, error, type Env } from '../../_lib';
import { filterEcosystem, loadRegistryV3, toEcosystemItem } from '../../_registry';

interface McpArgs {
  category?: string;
  search?: string;
  verified?: boolean;
  sort?: string;
  limit?: number;
  slug?: string;
  q?: string;
  id?: string;
  version?: string;
  type?: string;
  channel?: string;
  capability?: string;
}

interface JsonRpcBody {
  id?: unknown;
  method?: string;
  params?: { name?: string; arguments?: McpArgs };
}

const TOOLS = [
  {
    name: 'list_plugins',
    description: '列出 DSH 插件，可按分类/关键词/排序过滤',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        search: { type: 'string' },
        verified: { type: 'boolean' },
        sort: { type: 'string', enum: ['stars', 'trend', 'updated', 'created', 'name'], default: 'stars' },
        limit: { type: 'number', default: 20 },
      },
    },
  },
  {
    name: 'get_plugin',
    description: '获取单个插件详情（含 README 摘要与安装命令）',
    inputSchema: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] },
  },
  {
    name: 'list_categories',
    description: '列出所有插件分类及数量',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'search_plugins',
    description: '关键词搜索插件',
    inputSchema: { type: 'object', properties: { q: { type: 'string' }, limit: { type: 'number', default: 10 } }, required: ['q'] },
  },
  {
    name: 'list_ecosystem',
    description: '从 Registry V3 查询 plugin / MCP / skill / agent；只读，不修改本机状态',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['plugin', 'mcp', 'skill', 'agent'] },
        search: { type: 'string' },
        capability: { type: 'string' },
        verified: { type: 'boolean' },
        limit: { type: 'number', default: 20 },
      },
    },
  },
  {
    name: 'get_ecosystem_item',
    description: '读取 Registry V3 中单个生态条目及本地 Runtime 安装计划',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, version: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'plan_local_install',
    description: '生成本地 DSH Runtime 安装命令；仅生成计划，不执行安装',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, version: { type: 'string' } }, required: ['id'] },
  },
];

function rpcResult(id: unknown, result: unknown) {
  return json({ jsonrpc: '2.0', id, result });
}
function rpcError(id: unknown, code: number, message: string) {
  return json({ jsonrpc: '2.0', id, error: { code, message } }, { status: 400 });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
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
    if (method === 'initialize') {
      return rpcResult(id, {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'dsh-go', version: '2.3.0' },
      });
    }
    if (method === 'tools/list') return rpcResult(id, { tools: TOOLS });

    if (method === 'tools/call') {
      const { name, arguments: args } = params || {};
      let result: unknown;

      switch (name) {
        case 'list_plugins': {
          const { data } = await loadCatalog(env);
          const q = { category: args?.category, search: args?.search, verified: args?.verified === true, sort: args?.sort || 'stars' };
          const limit = Math.max(1, Math.min(Number(args?.limit) || 20, 100));
          result = filterPlugins(data.plugins, q).slice(0, limit).map((plugin) => ({
            slug: plugin.slug,
            name: plugin.name,
            category: plugin.category,
            stars: plugin.stars,
            description: plugin.description,
            install: plugin.install_cmd,
            verified: plugin.verified,
          }));
          break;
        }
        case 'get_plugin': {
          const { data } = await loadCatalog(env);
          const requestedSlug = String(args?.slug || '').toLowerCase();
          result = filterPlugins(data.plugins, {}).find((plugin) => plugin.slug.toLowerCase() === requestedSlug) || null;
          break;
        }
        case 'list_categories': {
          const { data } = await loadCatalog(env);
          const counts: Record<string, number> = {};
          for (const plugin of filterPlugins(data.plugins, {})) counts[plugin.category || 'other'] = (counts[plugin.category || 'other'] || 0) + 1;
          result = counts;
          break;
        }
        case 'search_plugins': {
          const { data } = await loadCatalog(env);
          const keyword = (args?.q || '').toLowerCase();
          const limit = Math.max(1, Math.min(Number(args?.limit) || 10, 100));
          result = filterPlugins(data.plugins, { search: keyword, sort: 'stars' })
            .slice(0, limit)
            .map((plugin) => ({ slug: plugin.slug, name: plugin.name, stars: plugin.stars, description: plugin.description }));
          break;
        }
        case 'list_ecosystem': {
          const { data } = await loadRegistryV3(env, request.url);
          const limit = Math.max(1, Math.min(Number(args?.limit) || 20, 100));
          result = filterEcosystem(data.plugins, {
            type: args?.type,
            channel: args?.channel,
            capability: args?.capability,
            search: args?.search,
            verified: args?.verified,
          }).slice(0, limit).map(toEcosystemItem);
          break;
        }
        case 'get_ecosystem_item':
        case 'plan_local_install': {
          if (!args?.id) return rpcError(id, -32602, 'id is required');
          const { data } = await loadRegistryV3(env, request.url);
          const match = data.plugins.find((plugin) => plugin.id === args.id && (!args.version || plugin.version === args.version));
          if (!match) return rpcError(id, -32602, `ecosystem item not found: ${args.id}`);
          const item = toEcosystemItem(match);
          result = name === 'plan_local_install' ? item.local_install : item;
          break;
        }
        default:
          return rpcError(id, -32601, `unknown tool: ${name}`);
      }

      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
    }

    if (method === 'notifications/initialized') return new Response(null, { status: 202 });
    return rpcError(id, -32601, `unsupported method: ${method}`);
  } catch (cause) {
    console.error('[dsh-go] mcp internal error:', cause);
    return rpcError(id, -32603, 'internal error');
  }
};

export const onRequestGet: PagesFunction = async () =>
  json({
    name: 'DSH Go MCP',
    description: 'Read-only JSON-RPC 2.0 catalog discovery. Local mutation tools are intentionally not exposed by this remote endpoint.',
    tools: TOOLS.map((tool) => tool.name),
  });

export const onRequestOptions: PagesFunction = async () =>
  json(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
      'Access-Control-Max-Age': '86400',
    },
  });
