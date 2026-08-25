export type MarketplaceItemType = 'plugin' | 'mcp' | 'skill' | 'agent';
export type ReleaseChannel = 'stable' | 'beta' | 'nightly' | 'dev';

export interface MarketplaceDependency {
  id: string;
  range?: string;
  optional?: boolean;
}

export interface MarketplaceSource {
  type: 'github' | 'npm' | 'custom';
  url: string;
  repo?: string;
  ref?: string;
  commit?: string;
}

export interface MarketplaceArtifact {
  integrity?: string;
  archiveUrl?: string;
}

export interface MarketplaceItem {
  id: string;
  name: string;
  type: MarketplaceItemType;
  version: string;
  channel: ReleaseChannel;
  description?: string;
  source: MarketplaceSource;
  runtime?: {
    dsh?: string;
    type?: string;
  };
  capabilities: string[];
  dependencies: MarketplaceDependency[];
  artifact?: MarketplaceArtifact;
  verified?: boolean;
}

export interface RegistryV3Item {
  id: string;
  name?: string;
  version: string;
  channel?: ReleaseChannel;
  release_channel?: ReleaseChannel;
  description?: string;
  verified?: boolean;
  source?: {
    provider?: string;
    repo?: string;
    ref?: string;
    commit?: string;
    archive_url?: string;
  };
  runtime?: {
    type?: string;
    dsh?: string;
  };
  capabilities?: string[];
  dependencies?: Array<string | MarketplaceDependency>;
  artifact?: {
    integrity?: string;
  };
  metadata?: {
    name?: string;
    description?: string;
  };
}

function inferItemType(item: RegistryV3Item): MarketplaceItemType {
  const runtimeType = item.runtime?.type;
  if (runtimeType === 'mcp' || runtimeType === 'skill' || runtimeType === 'agent') return runtimeType;
  const capabilities = item.capabilities ?? [];
  if (capabilities.includes('mcp')) return 'mcp';
  if (capabilities.includes('skill')) return 'skill';
  if (capabilities.includes('agent')) return 'agent';
  return 'plugin';
}

function normalizeDependency(dependency: string | MarketplaceDependency): MarketplaceDependency {
  if (typeof dependency !== 'string') {
    return { id: dependency.id, range: dependency.range ?? '*', optional: dependency.optional === true };
  }
  const at = dependency.lastIndexOf('@');
  return at > 0
    ? { id: dependency.slice(0, at), range: dependency.slice(at + 1) || '*', optional: false }
    : { id: dependency, range: '*', optional: false };
}

export function marketplaceItemFromRegistry(item: RegistryV3Item): MarketplaceItem {
  const provider = item.source?.provider ?? 'github';
  const sourceType: MarketplaceSource['type'] = provider === 'npm' ? 'npm' : provider === 'github' ? 'github' : 'custom';
  const repo = item.source?.repo;
  const url = item.source?.archive_url
    ?? (sourceType === 'github' && repo ? `https://github.com/${repo}` : repo ?? '');

  return {
    id: item.id,
    name: item.name ?? item.metadata?.name ?? item.id,
    type: inferItemType(item),
    version: item.version,
    channel: item.channel ?? item.release_channel ?? 'stable',
    description: item.description ?? item.metadata?.description,
    source: {
      type: sourceType,
      url,
      repo,
      ref: item.source?.ref,
      commit: item.source?.commit,
    },
    runtime: item.runtime,
    capabilities: [...(item.capabilities ?? [])],
    dependencies: (item.dependencies ?? []).map(normalizeDependency),
    artifact: item.artifact ? { integrity: item.artifact.integrity, archiveUrl: item.source?.archive_url } : undefined,
    verified: item.verified,
  };
}
