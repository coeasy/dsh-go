import { apiData, optionsResponse, requestId } from '../../_api-v2';
import type { Env } from '../../_lib';

export const onRequestGet: PagesFunction<Env> = async ({ request }) => apiData({
  name: 'DSH Go API',
  version: 2,
  registry_schema: 4,
  protocol_version: 2,
  endpoints: {
    packages: '/api/v2/packages',
    search: '/api/v2/search',
    resolve: '/api/v2/resolve',
    install_plan: '/api/v2/install-plan',
    publishers: '/api/v2/publishers',
    advisories: '/api/v2/advisories',
    registry_revision: '/api/v2/registry/revision',
    health: '/api/v2/health',
    mcp: '/api/v2/mcp',
  },
}, { request_id: requestId(request) });

export const onRequestOptions: PagesFunction = () => optionsResponse();
