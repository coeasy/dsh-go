import { json, type Env } from '../../_lib';

const ENDPOINTS = Object.freeze({
  capabilities: '/api/v1/capabilities',
  plugins: '/api/v1/plugins',
  search: '/api/v1/search',
  categories: '/api/v1/categories',
  stats: '/api/v1/stats',
  ecosystem: '/api/v1/ecosystem',
  registry: '/api/v1/registry',
  registry_delta: '/api/v1/registry/delta',
  package_versions: '/api/v1/registry/packages/:type/:id/versions',
  marketplace: '/api/v1/marketplace',
  package_detail_v2: '/api/v1/package-detail?id=:id&type=:type',
  install_plan: '/api/v1/install-plan?id=:id&type=:type',
  advisories: '/api/v1/advisories',
  publisher: '/api/v1/publishers/:id',
  profiles: '/api/v1/profiles',
  bundles: '/api/v1/bundles',
  providers: '/api/v1/providers',
  mcp: '/api/v1/mcp',
  meta: '/api/v1/meta',
  health: '/api/v1/health',
  discovery: '/.well-known/dsh-marketplace.json',
});

export const onRequestGet: PagesFunction<Env> = async ({ request }) => {
  const origin = new URL(request.url).origin;
  return json({
    service: { id: 'dsh-go', name: 'DSH Go Marketplace', mode: 'read-only', marketplace_version: 4 },
    api_version: 'v1',
    contract: 'dsh-marketplace-api.v1',
    base_url: origin,
    endpoints: Object.fromEntries(Object.entries(ENDPOINTS).map(([name, path]) => [name, new URL(path, origin).toString()])),
    package_types: ['plugin', 'mcp', 'skill', 'agent'],
    locales: ['en', 'zh-CN', 'ja', 'ko', 'es'],
    trust: { independent_from_popularity: true, publisher_identity_required_for_verified_tier: true },
    installation: {
      mode: 'plan-only',
      remote_mutation: false,
      explicit_confirmation_required: true,
      restart_required_after_install: true,
      auto_restart: false,
      deep_link_scheme: 'dsh',
    },
  }, { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=3600' } });
};

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, If-None-Match, Accept-Language',
    'Access-Control-Max-Age': '86400',
  },
});
