export const DEFAULT_PACKAGE_VERSION = '0.1.0';
export const POPULAR_STARS_MIN = 100;
export const POPULAR_STARS_MAX = 5000;
export const HOME_RECOMMENDATION_HARD_MAX = 10000;
export const HOME_TOP_LIMIT = 100;

export type EcosystemType = 'plugin' | 'mcp' | 'skill' | 'agent';

export interface AlignedMarketplaceItem {
  id: string;
  key: string;
  slug: string;
  name: string;
  description: string;
  version: string;
  type: EcosystemType;
  verified: boolean;
  stars: number;
  rank: number;
  repo: string;
  repoUrl: string;
  commit: string;
  category: string;
  language: string;
  topics: string[];
  capabilities: string[];
  dependencies: number;
  updatedAt: string;
  installCommand: string;
  registry: any;
  legacy: any | null;
}

export function ecosystemType(item: any): EcosystemType {
  if (item?.type === 'mcp' || item?.type === 'skill' || item?.type === 'agent') return item.type;
  const runtime = item?.runtime?.type;
  if (runtime === 'mcp' || runtime === 'skill' || runtime === 'agent') return runtime;
  const capabilities = Array.isArray(item?.capabilities) ? item.capabilities : [];
  if (capabilities.includes('mcp')) return 'mcp';
  if (capabilities.includes('skill')) return 'skill';
  if (capabilities.includes('agent')) return 'agent';
  return 'plugin';
}

export function normalizeRepoKey(value?: string | null): string {
  let text = String(value || '').trim();
  if (!text) return '';
  text = text
    .replace(/^git\+/, '')
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^github:/i, '')
    .replace(/^\/+/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  const [owner, repo] = text.split('/').filter(Boolean);
  if (!owner || !repo) return text.toLowerCase();
  return `${owner}/${repo}`.toLowerCase();
}

export function isDefaultPopularStars(stars: number): boolean {
  const value = Number(stars || 0);
  return value >= POPULAR_STARS_MIN && value <= POPULAR_STARS_MAX;
}

function dateValue(value?: string): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function compareMarketplacePopularity(left: any, right: any): number {
  const starDelta = Number(right?.stars || 0) - Number(left?.stars || 0);
  if (starDelta) return starDelta;
  const verifiedDelta = Number(Boolean(right?.verified)) - Number(Boolean(left?.verified));
  if (verifiedDelta) return verifiedDelta;
  const trendDelta = Number(right?.trend_score || right?.trend || 0) - Number(left?.trend_score || left?.trend || 0);
  if (trendDelta) return trendDelta;
  const updatedDelta = dateValue(right?.updated_at || right?.updatedAt) - dateValue(left?.updated_at || left?.updatedAt);
  if (updatedDelta) return updatedDelta;
  return String(left?.name || left?.id || '').localeCompare(String(right?.name || right?.id || ''));
}

export function selectHomeTop100<T extends { stars?: number; deprecated?: boolean; disabled?: boolean }>(items: T[]): T[] {
  return [...items]
    .filter((item) => !item.deprecated && !item.disabled)
    .filter((item) => {
      const stars = Number(item.stars || 0);
      return isDefaultPopularStars(stars) && stars <= HOME_RECOMMENDATION_HARD_MAX;
    })
    .sort(compareMarketplacePopularity)
    .slice(0, HOME_TOP_LIMIT);
}

export function buildLegacyRepoIndex(plugins: any[]): Map<string, any> {
  const index = new Map<string, any>();
  for (const plugin of plugins || []) {
    const candidates = [plugin?.full_name, plugin?.repo_url, plugin?.source?.repo];
    for (const candidate of candidates) {
      const key = normalizeRepoKey(candidate);
      if (key && !index.has(key)) index.set(key, plugin);
    }
  }
  return index;
}

export function findRegistryMatchForLegacy(plugin: any, registryItems: any[]): any | null {
  const repoKey = normalizeRepoKey(plugin?.full_name || plugin?.repo_url || plugin?.source?.repo);
  if (repoKey) {
    const byRepo = (registryItems || []).find((item) => normalizeRepoKey(item?.source?.repo) === repoKey);
    if (byRepo) return byRepo;
  }

  const legacyId = String(plugin?.id || plugin?.package_id || plugin?.slug || '').trim().toLowerCase();
  if (!legacyId) return null;
  return (registryItems || []).find((item) => {
    const registryRepo = normalizeRepoKey(item?.source?.repo);
    if (repoKey && registryRepo && registryRepo !== repoKey) return false;
    return String(item?.id || '').trim().toLowerCase() === legacyId;
  }) || null;
}

export function alignRegistryItem(item: any, legacyIndex: Map<string, any>): AlignedMarketplaceItem {
  const type = ecosystemType(item);
  const repo = String(item?.source?.repo || '').trim();
  const legacy = legacyIndex.get(normalizeRepoKey(repo)) || null;
  const metadata = item?.metadata || {};
  const version = String(item?.version || legacy?.version || DEFAULT_PACKAGE_VERSION);
  const name = String(legacy?.name || metadata.name || item?.id || 'unknown');
  const stars = Number(legacy?.stars ?? metadata.stars ?? 0);
  const category = String(legacy?.category || metadata.category || (type === 'skill' ? 'skills' : type));
  const capabilities = Array.isArray(item?.capabilities) ? item.capabilities.filter((value: unknown): value is string => typeof value === 'string') : [];
  const topics = Array.isArray(legacy?.topics) ? legacy.topics.filter((value: unknown): value is string => typeof value === 'string') : capabilities;
  const fullName = String(legacy?.full_name || repo || item?.id || '');
  return {
    id: String(item?.id || ''),
    key: `${type}:${String(item?.id || '')}`,
    slug: String(legacy?.slug || item?.id || ''),
    name,
    description: String(legacy?.description || metadata.description || ''),
    version,
    type,
    verified: legacy?.verified === true || metadata.verified === true,
    stars,
    rank: Number(metadata.rank || legacy?.rank || 0),
    repo: fullName,
    repoUrl: String(legacy?.repo_url || metadata.repo_url || (repo ? `https://github.com/${repo}` : '')),
    commit: String(item?.source?.commit || ''),
    category,
    language: String(legacy?.language || ''),
    topics,
    capabilities,
    dependencies: Array.isArray(item?.dependencies) ? item.dependencies.length : 0,
    updatedAt: String(legacy?.updated_at || item?.source?.updated_at || ''),
    installCommand: `dsh ${type} install ${String(item?.id || '')}@${version}`,
    registry: item,
    legacy,
  };
}

export function preferAlignedVariant(current: AlignedMarketplaceItem | undefined, candidate: AlignedMarketplaceItem): AlignedMarketplaceItem {
  if (!current) return candidate;
  const currentStable = (current.registry?.channel || current.registry?.release_channel || 'stable') === 'stable';
  const candidateStable = (candidate.registry?.channel || candidate.registry?.release_channel || 'stable') === 'stable';
  if (currentStable !== candidateStable) return candidateStable ? candidate : current;
  return String(candidate.version).localeCompare(String(current.version), undefined, { numeric: true, sensitivity: 'base' }) > 0 ? candidate : current;
}
