export type MarketplacePackageType = 'plugin' | 'mcp' | 'skill' | 'agent';
export type MarketplaceChannel = 'stable' | 'beta' | 'nightly' | 'dev';

export interface MarketplaceInstallRequest {
  type: MarketplacePackageType;
  id: string;
  version?: string | null;
  channel?: unknown;
  registry?: string | null;
}

export interface MarketplaceInstallPlan {
  type: MarketplacePackageType;
  id: string;
  versionRange: string;
  channel: MarketplaceChannel;
  registry?: string;
  command: string;
  deepLink: string;
}

const TYPES = new Set<MarketplacePackageType>(['plugin', 'mcp', 'skill', 'agent']);
const CHANNELS = new Set<MarketplaceChannel>(['stable', 'beta', 'nightly', 'dev']);

export function normalizeMarketplacePackageType(value: unknown): MarketplacePackageType {
  const normalized = String(value || 'plugin').toLowerCase() as MarketplacePackageType;
  return TYPES.has(normalized) ? normalized : 'plugin';
}

export function normalizeMarketplaceChannel(value: unknown): MarketplaceChannel {
  const normalized = String(value || 'stable').toLowerCase() as MarketplaceChannel;
  return CHANNELS.has(normalized) ? normalized : 'stable';
}

export function buildMarketplaceInstallPlan(input: MarketplaceInstallRequest): MarketplaceInstallPlan {
  const type = normalizeMarketplacePackageType(input.type);
  const id = String(input.id || '').trim();
  if (!id) throw new Error('marketplace install request requires package id');
  const versionRange = String(input.version || '*').trim() || '*';
  const channel = normalizeMarketplaceChannel(input.channel);
  const registry = String(input.registry || '').trim() || undefined;

  const target = versionRange === '*' ? id : `${id}@${versionRange}`;
  const argv = ['dsh', type, 'install', target];
  if (channel !== 'stable') argv.push('--channel', channel);
  if (registry) argv.push('--registry', registry);

  const url = new URL('dsh://install');
  url.searchParams.set('id', id);
  url.searchParams.set('version', versionRange);
  url.searchParams.set('channel', channel);
  url.searchParams.set('type', type);
  if (registry) url.searchParams.set('registry', registry);

  return {
    type,
    id,
    versionRange,
    channel,
    ...(registry ? { registry } : {}),
    command: argv.join(' '),
    deepLink: url.toString(),
  };
}
