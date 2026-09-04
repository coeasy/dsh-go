import marketplacePolicy from '../../../config/marketplace-policy.json';

export const HOME_MIN_STARS = marketplacePolicy.discovery.home_min_stars;
export const HOME_MAX_STARS = marketplacePolicy.discovery.home_max_stars;
export const HOME_HARD_MAX_STARS = marketplacePolicy.discovery.home_hard_max_stars;
export const HOME_TOP_LIMIT = marketplacePolicy.discovery.home_top_limit;

export interface MarketplacePlugin {
  slug?: string;
  name?: string;
  full_name?: string;
  repo_url?: string;
  description?: string;
  topics?: string[];
  tags?: string[];
  category?: string;
  stars?: number;
  trend_score?: number;
  verified?: boolean;
  deprecated?: boolean;
  disabled?: boolean;
  updated_at?: string;
  [key: string]: unknown;
}

export interface RegistryEntry {
  id?: string;
  kind?: string;
  type?: string;
  version?: string;
  source?: { repo?: string; commit?: string };
  runtime?: { type?: string };
  capabilities?: string[];
  metadata?: { name?: string; description?: string; verified?: boolean; stars?: number; rank?: number };
  [key: string]: unknown;
}

export type EcosystemType = 'plugin' | 'mcp' | 'skill' | 'agent';

export function ecosystemType(entry?: RegistryEntry | null): EcosystemType {
  if (!entry) return 'plugin';
  const declared = String(entry.kind || entry.type || '').toLowerCase();
  if (declared === 'mcp' || declared === 'skill' || declared === 'agent' || declared === 'plugin') return declared;
  if (declared === 'mcp-server' || declared === 'mcp_server') return 'mcp';
  const runtime = String(entry.runtime?.type || '').toLowerCase();
  if (runtime === 'mcp' || runtime === 'skill' || runtime === 'agent') return runtime;
  const capabilities = entry.capabilities ?? [];
  if (capabilities.includes('mcp')) return 'mcp';
  if (capabilities.includes('skill')) return 'skill';
  if (capabilities.includes('agent')) return 'agent';
  return 'plugin';
}

export function normalizeRepo(value?: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const githubMatch = raw.match(/(?:https?:\/\/|ssh:\/\/git@|git@)?github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[#/?].*)?$/i);
  const candidate = githubMatch
    ? `${githubMatch[1]}/${githubMatch[2]}`
    : raw.replace(/^github:/i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  const parts = candidate.split('/').filter(Boolean);
  if (parts.length !== 2) return '';
  return `${parts[0].toLowerCase()}/${parts[1].toLowerCase()}`;
}

export function isActivePlugin(plugin: MarketplacePlugin): boolean {
  return !plugin.deprecated && !plugin.disabled;
}

function normalizedDiscoveryName(value?: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_.]+/g, '-')
    .replace(/-+/g, '-');
}

export function isDiscoveryAggregator(plugin: MarketplacePlugin): boolean {
  const repo = normalizeRepo(plugin.full_name || plugin.repo_url);
  const repoName = repo.split('/').pop() || '';
  const candidates = [plugin.slug, plugin.name, repoName]
    .map((value) => normalizedDiscoveryName(String(value || '')))
    .filter(Boolean);

  const awesomeName = /(^|-)awesome(-|$)/;
  const curatedName = /(^|-)curated-list(-|$)/;
  const ecosystemListName = /(^|-)(plugins?|mcp|skills?|agents?|tools?|resources?)-(list|directory|collection)(-|$)|(^|-)(list|directory|collection)-(plugins?|mcp|skills?|agents?|tools?|resources?)(-|$)/;
  if (candidates.some((value) => awesomeName.test(value) || curatedName.test(value) || ecosystemListName.test(value))) return true;

  const topics = [...(plugin.topics || []), ...(plugin.tags || [])].map((topic) => normalizedDiscoveryName(topic));
  if (topics.some((topic) => ['awesome', 'awesome-list', 'awesome-lists', 'curated-list', 'resource-list'].includes(topic))) return true;

  const description = String(plugin.description || '').trim().toLowerCase();
  return /\b(awesome|curated)\s+(list|collection|directory)\b/.test(description)
    || /\b(collection|directory|list)\s+of\s+(plugins?|tools?|resources?|projects?|agents?|skills?|mcp|servers?)\b/.test(description);
}

export function isHomePopular(plugin: MarketplacePlugin): boolean {
  const stars = Number(plugin.stars || 0);
  return isActivePlugin(plugin)
    && !isDiscoveryAggregator(plugin)
    && stars >= HOME_MIN_STARS
    && stars <= HOME_MAX_STARS
    && stars < HOME_HARD_MAX_STARS;
}

export function marketplaceUpdatedAtTimestamp(updatedAt?: string): number {
  const timestamp = Date.parse(String(updatedAt || ''));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function recencyScore(updatedAt?: string): number {
  const timestamp = marketplaceUpdatedAtTimestamp(updatedAt);
  if (!timestamp) return 0;
  const days = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  if (days <= 7) return 1;
  if (days <= 30) return 0.75;
  if (days <= 90) return 0.45;
  if (days <= 180) return 0.2;
  return 0;
}

function marketplaceQualityScore(plugin: MarketplacePlugin): number {
  const stars = Math.max(HOME_MIN_STARS, Number(plugin.stars || 0));
  const starScore = Math.min(1, Math.log10(stars + 1) / Math.log10(HOME_MAX_STARS + 1));
  const trend = Math.max(0, Number(plugin.trend_score || 0));
  const trendScore = Math.min(1, Math.log10(trend + 1) / 3);
  const verifiedScore = plugin.verified ? 1 : 0;
  return starScore * 0.5 + trendScore * 0.2 + recencyScore(plugin.updated_at) * 0.2 + verifiedScore * 0.1;
}

/**
 * Homepage ranking key. Repository updated_at is the primary signal; the
 * existing quality score only breaks ties. Keeping this logic in one helper
 * lets both the standalone selector and the unified homepage use the same rule.
 */
export function marketplaceScore(plugin: MarketplacePlugin): number {
  return marketplaceUpdatedAtTimestamp(plugin.updated_at) * 2 + marketplaceQualityScore(plugin);
}

export function selectHomeTop100<T extends MarketplacePlugin>(plugins: T[]): T[] {
  return plugins
    .filter(isHomePopular)
    .map((plugin) => ({ plugin, score: marketplaceScore(plugin) }))
    .sort((left, right) => right.score - left.score
      || Number(right.plugin.stars || 0) - Number(left.plugin.stars || 0)
      || String(left.plugin.name || left.plugin.slug || '').localeCompare(String(right.plugin.name || right.plugin.slug || '')))
    .slice(0, HOME_TOP_LIMIT)
    .map(({ plugin }) => plugin);
}

export function compareRegistryVersionsDesc(left: RegistryEntry, right: RegistryEntry): number {
  return String(right.version || '').localeCompare(String(left.version || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

export function buildRegistryRepoIndex(entries: RegistryEntry[]): Map<string, RegistryEntry[]> {
  const index = new Map<string, RegistryEntry[]>();
  for (const entry of entries || []) {
    const repo = normalizeRepo(entry.source?.repo);
    if (!repo) continue;
    const group = index.get(repo) ?? [];
    group.push(entry);
    index.set(repo, group);
  }
  for (const group of index.values()) group.sort(compareRegistryVersionsDesc);
  return index;
}

export function registryMatchesForPlugin(plugin: MarketplacePlugin, index: Map<string, RegistryEntry[]>): RegistryEntry[] {
  const repo = normalizeRepo(plugin.full_name || plugin.repo_url);
  return repo ? (index.get(repo) ?? []) : [];
}

export function primaryRegistryMatch(entries: RegistryEntry[]): RegistryEntry | null {
  return entries[0] ?? null;
}
