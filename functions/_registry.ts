import type { Env } from './_lib';

export type EcosystemType = 'plugin' | 'mcp' | 'skill' | 'agent';

export interface RegistryDependency {
  id: string;
  range?: string;
  version?: string;
  optional?: boolean;
}

export interface RegistryV3Plugin {
  id: string;
  version: string;
  source: {
    provider: string;
    repo: string;
    ref: string;
    commit: string;
    archive_url?: string;
  };
  artifact?: {
    integrity?: string;
  };
  runtime?: {
    type?: string;
    activation?: string;
  };
  capabilities?: string[];
  dependencies?: Array<string | RegistryDependency>;
  metadata?: {
    name?: string;
    description?: string;
    category?: string;
    verified?: boolean;
    stars?: number;
    rank?: number;
    repo_url?: string;
    install_cmd?: string;
  };
}

export interface RegistryV3Data {
  registry_version: number;
  schema_version: string;
  defaults?: { plugin_version?: string };
  generated?: {
    at?: string;
    count?: number;
    content_hash?: string;
  };
  plugins: RegistryV3Plugin[];
}

export interface EcosystemQuery {
  type?: string;
  channel?: string;
  capability?: string;
  search?: string;
  verified?: boolean;
}

export interface EcosystemItem {
  id: string;
  name: string;
  type: EcosystemType;
  version: string;
  channel: string;
  description: string;
  verified: boolean;
  capabilities: string[];
  dependencies: Array<string | RegistryDependency>;
  source: RegistryV3Plugin['source'];
  artifact?: RegistryV3Plugin['artifact'];
  metadata: RegistryV3Plugin['metadata'];
  local_install: {
    command: string;
    executed: false;
    requires_local_runtime: true;
    restart_required: true;
  };
}

export function ecosystemType(plugin: RegistryV3Plugin): EcosystemType {
  const runtimeType = plugin.runtime?.type;
  if (runtimeType === 'mcp' || runtimeType === 'skill' || runtimeType === 'agent') return runtimeType;
  const capabilities = plugin.capabilities ?? [];
  if (capabilities.includes('mcp')) return 'mcp';
  if (capabilities.includes('skill')) return 'skill';
  if (capabilities.includes('agent')) return 'agent';
  return 'plugin';
}

export function toEcosystemItem(plugin: RegistryV3Plugin): EcosystemItem {
  const type = ecosystemType(plugin);
  return {
    id: plugin.id,
    name: plugin.metadata?.name ?? plugin.id,
    type,
    version: plugin.version,
    channel: 'stable',
    description: plugin.metadata?.description ?? '',
    verified: plugin.metadata?.verified === true,
    capabilities: [...(plugin.capabilities ?? [])],
    dependencies: [...(plugin.dependencies ?? [])],
    source: plugin.source,
    artifact: plugin.artifact,
    metadata: plugin.metadata ?? {},
    local_install: {
      command: `dsh plugin install ${plugin.id}@${plugin.version}`,
      executed: false,
      requires_local_runtime: true,
      restart_required: true,
    },
  };
}

export function filterEcosystem(plugins: RegistryV3Plugin[], query: EcosystemQuery): RegistryV3Plugin[] {
  const keyword = (query.search ?? '').trim().toLocaleLowerCase();
  const capability = (query.capability ?? '').trim().toLocaleLowerCase();
  return plugins
    .filter((plugin) => !query.type || ecosystemType(plugin) === query.type)
    .filter(() => !query.channel || query.channel === 'stable')
    .filter((plugin) => query.verified === undefined || (plugin.metadata?.verified === true) === query.verified)
    .filter((plugin) => !capability || (plugin.capabilities ?? []).some((value) => value.toLocaleLowerCase() === capability))
    .filter((plugin) => {
      if (!keyword) return true;
      return [plugin.id, plugin.source.repo, plugin.metadata?.name, plugin.metadata?.description]
        .some((value) => (value ?? '').toLocaleLowerCase().includes(keyword))
        || (plugin.capabilities ?? []).some((value) => value.toLocaleLowerCase().includes(keyword));
    })
    .sort((left, right) => {
      const rankLeft = Number(left.metadata?.rank || Number.MAX_SAFE_INTEGER);
      const rankRight = Number(right.metadata?.rank || Number.MAX_SAFE_INTEGER);
      if (rankLeft !== rankRight) return rankLeft - rankRight;
      const stars = Number(right.metadata?.stars || 0) - Number(left.metadata?.stars || 0);
      return stars || left.id.localeCompare(right.id);
    });
}

export async function loadRegistryV3(env: Env, requestUrl = 'https://dsh-go.pages.dev'): Promise<{ data: RegistryV3Data; etag: string }> {
  const response = await env.ASSETS.fetch(new URL('/catalog/registry-v3.json', requestUrl));
  if (!response.ok) throw new Error(`registry v3 load failed: ${response.status}`);
  const data = await response.json() as RegistryV3Data;
  if (data.registry_version !== 3 || !Array.isArray(data.plugins)) throw new Error('invalid Registry V3 payload');
  const headerEtag = response.headers.get('etag')?.replace(/^W\//, '').replaceAll('"', '') ?? '';
  const etag = data.generated?.content_hash || headerEtag || `registry-v3-${data.plugins.length}`;
  return { data, etag };
}
