// POST /api/v1/mcp — read-only MCP endpoint for catalog, Registry V3 and Marketplace V4 discovery.
import { loadCatalog, filterPlugins, json, error, type Env } from '../../_lib';
import { filterEcosystem, loadRegistryV3, toEcosystemItem } from '../../_registry';
import { resolveEdgePackageRequest } from '../../_package-request';
import { loadLocalizationOverlay, normalizeLocale, packageDetailV2, publisherSummary, trustFor } from '../../_marketplace-v4';

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
  publisher?: string;
  locale?: string;
}

interface JsonRpcBody {
  id?: unknown;
  method?: string;
  params?: { name?: string; arguments?: McpArgs };
}

const ECOSYSTEM_TYPES = ['plugin', 'mcp', 'skill', 'agent'] as const;
const CHANNELS = ['stable', 'beta', 'nightly', 'dev'] as const;

const packageRequestSchema = {
  id: { type: 'string' },
  version: { type: 'string', description: 'Semver range; omitted means latest compatible release in the selected channel.' },
  type: { type: 'string', enum: ECOSYSTEM_TYPES },
  channel: { type: 'string', enum: CHANNELS, default: 'stable' },
  locale: { type: 'string', description: 'Presentation locale only; never changes package identity.' },
};

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
  { name: 'list_categories', description: '列出所有插件分类及数量', inputSchema: { type: 'object', properties: {} } },
  { name: 'search_plugins', description: '关键词搜索插件', inputSchema: { type: 'object', properties: { q: { type: 'string' }, limit: { type: 'number', default: 10 } }, required: ['q'] } },
  {
    name: 'list_ecosystem',
    description: '从 Registry V3 查询 plugin / MCP / skill / agent；只读，不修改本机状态',
    inputSchema: { type: 'object', properties: { type: { type: 'string', enum: ECOSYSTEM_TYPES }, search: { type: 'string' }, capability: { type: 'string' }, verified: { type: 'boolean' }, channel: { type: 'string', enum: CHANNELS }, limit: { type: 'number', default: 20 } } },
  },
  {
    name: 'get_ecosystem_item',
    description: '读取 Registry V3 中单个生态条目；支持 latest/exact/semver range/channel，同 ID 多类型时应传 type',
    inputSchema: { type: 'object', properties: packageRequestSchema, required: ['id'] },
  },
  {
    name: 'plan_local_install',
    description: '生成本地 DSH Runtime 安装命令；仅生成计划，不执行安装',
    inputSchema: { type: 'object', properties: packageRequestSchema, required: ['id'] },
  },
  {
    name: 'get_package_trust',
    description: '读取 package trust 证据与分层；Trust 与 popularity 独立',
    inputSchema: { type: 'object', properties: packageRequestSchema, required: ['id'] },
  },
  {
    name: 'get_package_advisories',
    description: '读取 package advisory/yank/revoke 信息；只读',
    inputSchema: { type: 'object', properties: packageRequestSchema, required: ['id'] },
  },
  {
    name: 'get_publisher',
    description: '读取 Publisher 身份、包列表和聚合 trust',
    inputSchema: { type: 'object', properties: { publisher: { type: 'string' }, locale: { type: 'string' } }, required: ['publisher'] },
  },
];

function rpcResult(id: unknown, result: unknown) { return json({ jsonrpc: '2.0', id, result }); }
function rpcError(id: unknown, code: number, message: string) { return json({ jsonrpc: '2.0', id, error: { code, message } }, { status: 400 }); }

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const len = Number(request.headers.get('content-length'));
  if (Number.isFinite(len) && len > 1_000_000) return error(413, 'payload too large');
  let body: unknown;
  try { body = await request.json(); } catch { return error(400, 'invalid JSON body'); }
  const parsed = body as JsonRpcBody | null;
  const id = parsed?.id;
  const method = parsed?.method;
  const params = parsed?.params;
  if (!method) return error(400, 'missing method');

  try {
    if (method === 'initialize') return rpcResult(id, { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'dsh-go', version: '0.1.0' } });
    if (method === 'tools/list') return rpcResult(id, { tools: TOOLS });
    if (method === 'tools/call') {
      const { name, arguments: args } = params || {};
      let result: unknown;
      switch (name) {
        case 'list_plugins': {
          const { data } = await loadCatalog(env);
          const q = { category: args?.category, search: args?.search, verified: args?.verified, sort: args?.sort || 'stars' };
          const limit = Math.max(1, Math.min(Number(args?.limit) || 20, 100));
          result = filterPlugins(data.plugins, q).slice(0, limit).map((plugin) => ({ slug: plugin.slug, name: plugin.name, category: plugin.category, stars: plugin.stars, description: plugin.description, install: plugin.install_cmd, verified: plugin.verified }));
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
          result = filterPlugins(data.plugins, { search: keyword, sort: 'stars' }).slice(0, limit).map((plugin) => ({ slug: plugin.slug, name: plugin.name, stars: plugin.stars, description: plugin.description }));
          break;
        }
        case 'list_ecosystem': {
          const { data } = await loadRegistryV3(env, request.url);
          const limit = Math.max(1, Math.min(Number(args?.limit) || 20, 100));
          result = filterEcosystem(data.plugins, { type: args?.type, channel: args?.channel, capability: args?.capability, search: args?.search, verified: args?.verified }).slice(0, limit).map(toEcosystemItem);
          break;
        }
        case 'get_publisher': {
          if (!args?.publisher) return rpcError(id, -32602, 'publisher is required');
          const { data } = await loadRegistryV3(env, request.url);
          const locale = normalizeLocale(args.locale);
          const overlay = await loadLocalizationOverlay(env, request.url, locale);
          result = { locale, ...publisherSummary(data, args.publisher, overlay) };
          break;
        }
        case 'get_ecosystem_item':
        case 'plan_local_install':
        case 'get_package_trust':
        case 'get_package_advisories': {
          if (!args?.id) return rpcError(id, -32602, 'id is required');
          const { data } = await loadRegistryV3(env, request.url);
          let selection;
          try { selection = resolveEdgePackageRequest(data.plugins, { id: args.id, type: args.type, version: args.version, channel: args.channel }); }
          catch (cause) { return rpcError(id, -32602, cause instanceof Error ? cause.message : String(cause)); }
          const item = toEcosystemItem(selection.package);
          const locale = normalizeLocale(args.locale);
          const overlay = await loadLocalizationOverlay(env, request.url, locale);
          if (name === 'plan_local_install') {
            result = { ...item.local_install, request: { id: selection.request.id, type: selection.request.type || item.type, version_range: selection.request.versionRange, channel: selection.request.channel }, resolved: { id: item.id, type: item.type, version: item.version, channel: item.channel }, locale, executed: false };
          } else if (name === 'get_package_trust') {
            result = { package: { id: item.id, type: item.type, version: item.version }, trust: trustFor(selection.package), popularity: Number(selection.package.metadata?.stars || 0), trust_is_popularity: false };
          } else if (name === 'get_package_advisories') {
            const security: any = selection.package.security || {};
            result = { package: { id: item.id, type: item.type, version: item.version }, advisories: security.advisories || [], yanked: security.yanked === true, revoked: security.revoked === true, minimum_safe_version: security.minimum_safe_version || null };
          } else {
            const detail = packageDetailV2(selection.package, overlay);
            result = { ...item, ...detail, id: item.id, type: item.type, version: item.version, channel: item.channel, local_install: detail.local_install };
          }
          break;
        }
        default: return rpcError(id, -32601, `unknown tool: ${name}`);
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

export const onRequestGet: PagesFunction = async () => json({ name: 'DSH Go MCP', version: '0.1.0', api: '/api/v1/mcp', description: 'Read-only Marketplace V4 discovery, install planning, trust, advisory and publisher information. Local mutation is intentionally not exposed.', tools: TOOLS.map((tool) => tool.name) });

export const onRequestOptions: PagesFunction = async () => json(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, If-None-Match, Accept-Language', 'Access-Control-Max-Age': '86400' } });
