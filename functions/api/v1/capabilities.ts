import { json, internalError, loadCatalog, type Env } from '../../_lib';
import { loadRegistryV3 } from '../../_registry';

const PACKAGE_TYPES = ['plugin', 'mcp', 'skill', 'agent'] as const;
const CHANNELS = ['stable', 'beta', 'nightly', 'dev'] as const;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const origin = new URL(request.url).origin;
    const [catalog, registry] = await Promise.all([
      loadCatalog(env),
      loadRegistryV3(env, request.url),
    ]);
    const scopedEtag = registry.etag + ':capabilities';

    return json({
      schema: 'dsh-marketplace-capabilities.v1',
      service: {
        id: 'dsh-go',
        name: 'DSH Go Marketplace',
        product_version: '0.1.0',
        mode: 'read-only',
      },
      api: {
        version: 'v1',
        base_url: origin,
        canonical_base_url: 'https://dsh-go.pages.dev',
        openapi_url: new URL('/openapi.json', origin).toString(),
        discovery_url: new URL('/.well-known/dsh-marketplace.json', origin).toString(),
        read_only: true,
        endpoints: {
          index: '/api/v1',
          health: '/api/v1/health',
          meta: '/api/v1/meta',
          capabilities: '/api/v1/capabilities',
          plugins: '/api/v1/plugins',
          plugin_detail: '/api/v1/plugins/{slug}',
          search: '/api/v1/search',
          categories: '/api/v1/categories',
          stats: '/api/v1/stats',
          ecosystem: '/api/v1/ecosystem',
          ecosystem_detail: '/api/v1/ecosystem/{id}',
          registry: '/api/v1/registry',
          registry_delta: '/api/v1/registry/delta',
          package: '/api/v1/registry/packages/{type}/{id}',
          package_versions: '/api/v1/registry/packages/{type}/{id}/versions',
          marketplace: '/api/v1/marketplace',
          package_detail_v2: '/api/v1/package-detail?id={id}&type={type}',
          install_plan: '/api/v1/install-plan?id={id}&type={type}',
          advisories: '/api/v1/advisories',
          publisher: '/api/v1/publishers/{id}',
          profiles: '/api/v1/profiles',
          bundles: '/api/v1/bundles',
          providers: '/api/v1/providers',
          provider_detail: '/api/v1/providers/{id}',
          mcp: '/api/v1/mcp',
        },
      },
      registry: {
        version: registry.data.registry_version,
        schema_version: registry.data.schema_version,
        count: registry.data.plugins.length,
        generated_at: registry.data.generated?.at || null,
        content_hash: registry.etag,
        distribution: {
          version: 1,
          index_path: '/catalog/distribution-v1/index.json',
          delta_path: '/catalog/distribution-v1/delta.json',
          package_endpoint: '/api/v1/registry/packages/{type}/{id}',
          versions_endpoint: '/api/v1/registry/packages/{type}/{id}/versions',
        },
      },
      catalog: {
        version: catalog.data.version,
        count: catalog.data.plugins.length,
        updated_at: catalog.data.meta.updated_at,
        etag: catalog.etag,
      },
      packages: {
        types: [...PACKAGE_TYPES],
        channels: [...CHANNELS],
        installation: {
          mode: 'plan-only',
          command_template: 'dsh {type} install {id}@{version}',
          deep_link_scheme: 'dsh',
          explicit_confirmation_required: true,
          restart_required_after_install: true,
          remote_mutation: false,
        },
      },
      deployments: [
        {
          id: 'cloudflare-pages',
          role: 'api-and-static-authority',
          url: 'https://dsh-go.pages.dev',
          api: true,
          static: true,
        },
        {
          id: 'github-pages',
          role: 'static-replica',
          url: 'https://coeasy.github.io/dsh-go/',
          api: false,
          static: true,
        },
        {
          id: 'edgeone-pages',
          role: 'static-replica',
          url: null,
          url_source: 'EDGEONE_SITE_URL or CLI deployment result',
          api: false,
          static: true,
        },
      ],
      consistency: {
        identity_file: '/version.json',
        registry_hash_source: '/catalog/registry-v3.json',
        required_convergence: ['git_sha', 'registry.content_hash', 'provider-adapters.content_hash'],
      },
      mcp: {
        endpoint: '/api/v1/mcp',
        transport: 'json-rpc-http',
        mutation_tools_exposed: false,
      },
    }, { headers: { 'Cache-Control': 'public, max-age=120, s-maxage=600' } }, scopedEtag);
  } catch (cause) {
    return internalError(cause);
  }
};

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
    'Access-Control-Max-Age': '86400',
  },
});
