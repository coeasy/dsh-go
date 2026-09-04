import { formatPackageCoordinate, normalizePackageRequest } from '../../../packages/protocol-core/index.mjs';
import { resolvePackage } from '../../../packages/resolver/index.mjs';
import { parseJsonBody } from '../../_api-v2';
import type { Env } from '../../_lib';
import { loadRegistryV4 } from '../../_registry-v4';
import { findRegistryPackage, publicPackage, searchRegistry, sortedReleases } from '../../_registry-v4-query';

const TOOL_DEFINITIONS = [
  ['package_search', 'Search Registry V4 packages', { type: 'object', properties: { query: { type: 'string' }, type: { type: 'string', enum: ['plugin', 'mcp', 'skill', 'agent'] }, limit: { type: 'number' } } }],
  ['package_get', 'Get one Registry V4 package', { type: 'object', required: ['type', 'id'], properties: { type: { type: 'string' }, id: { type: 'string' } } }],
  ['package_releases', 'List package releases', { type: 'object', required: ['type', 'id'], properties: { type: { type: 'string' }, id: { type: 'string' } } }],
  ['package_resolve', 'Resolve a package and dependencies without installing', { type: 'object', required: ['type', 'id'], properties: { type: { type: 'string' }, id: { type: 'string' }, range: { type: 'string' }, channel: { type: 'string' }, environment: { type: 'object' } } }],
  ['package_install_plan', 'Build a local install plan without executing it', { type: 'object', required: ['type', 'id'], properties: { type: { type: 'string' }, id: { type: 'string' }, range: { type: 'string' }, channel: { type: 'string' }, environment: { type: 'object' } } }],
  ['publisher_get', 'Get a publisher and its packages', { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }],
  ['advisory_get', 'Get a Registry V4 advisory', { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }],
  ['registry_status', 'Get Registry V4 revision and counts', { type: 'object', properties: {} }],
].map(([name, description, inputSchema]) => ({ name, description, inputSchema }));

function rpc(id: unknown, result?: unknown, error?: { code: number; message: string; data?: unknown }) {
  return new Response(JSON.stringify(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
  });
}

function textResult(value: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: any;
  try { body = await parseJsonBody(request); } catch (error) { return rpc(null, undefined, { code: -32700, message: error instanceof Error ? error.message : 'invalid JSON' }); }
  const id = body?.id ?? null;
  if (body?.jsonrpc !== '2.0') return rpc(id, undefined, { code: -32600, message: 'jsonrpc must be 2.0' });
  if (body.method === 'initialize') return rpc(id, { protocolVersion: '2025-06-18', serverInfo: { name: 'dsh-go', version: '2' }, capabilities: { tools: {} } });
  if (body.method === 'tools/list') return rpc(id, { tools: TOOL_DEFINITIONS });
  if (body.method !== 'tools/call') return rpc(id, undefined, { code: -32601, message: `method not found: ${body.method}` });

  try {
    const { data: registry } = await loadRegistryV4(env, request.url);
    const name = String(body.params?.name || '');
    const args = body.params?.arguments || {};
    let value: unknown;

    if (name === 'package_search') {
      value = searchRegistry(registry, String(args.query || ''), args.type || undefined, Number(args.limit || 50));
    } else if (name === 'package_get') {
      const pkg = findRegistryPackage(registry, args.type, args.id);
      if (!pkg) throw new Error('package not found');
      value = { ...publicPackage(pkg), releases: sortedReleases(pkg) };
    } else if (name === 'package_releases') {
      const pkg = findRegistryPackage(registry, args.type, args.id);
      if (!pkg) throw new Error('package not found');
      value = sortedReleases(pkg);
    } else if (name === 'package_resolve' || name === 'package_install_plan') {
      const packageRequest = normalizePackageRequest({ type: args.type, id: args.id, range: args.range || '*', channel: args.channel || 'stable' });
      const resolution = resolvePackage(registry, packageRequest, args.environment || {});
      if (name === 'package_resolve') value = resolution;
      else {
        const coordinate = formatPackageCoordinate(packageRequest);
        const params = new URLSearchParams({ spec: coordinate, channel: packageRequest.channel });
        value = { request: packageRequest, resolution, local: { cli: `dsh package install ${coordinate}`, deep_link: `dsh://package/install?${params.toString()}`, executes_remotely: false } };
      }
    } else if (name === 'publisher_get') {
      const publisher = (registry.publishers || []).find((item: any) => String(item.id || '').toLowerCase() === String(args.id || '').toLowerCase());
      if (!publisher) throw new Error('publisher not found');
      value = { publisher, packages: registry.packages.filter((pkg) => pkg.publisher_id === publisher.id).map(publicPackage) };
    } else if (name === 'advisory_get') {
      value = (registry.advisories || []).find((item: any) => String(item.id || '') === String(args.id || '')) || null;
      if (!value) throw new Error('advisory not found');
    } else if (name === 'registry_status') {
      value = { schema_version: 4, revision: registry.revision, generated_at: registry.generated_at, package_count: registry.packages.length };
    } else return rpc(id, undefined, { code: -32602, message: `unknown tool: ${name}` });

    return rpc(id, textResult(value));
  } catch (error) {
    return rpc(id, undefined, { code: -32000, message: error instanceof Error ? error.message : String(error) });
  }
};

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' },
});
