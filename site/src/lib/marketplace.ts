export const HOME_MIN_STARS = 100;
export const HOME_MAX_STARS = 5000;
export const HOME_HARD_MAX_STARS = 10000;
export const HOME_TOP_LIMIT = 100;

export interface MarketplacePlugin {
  slug?: string;
  name?: string;
  full_name?: string;
  repo_url?: string;
  description?: string;
  topics?: string[];
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
  if (entry.type === 'mcp' || entry.type === 'skill' || entry.type === 'agent') return entry.type;
  const runtime = entry.runtime?.type;
  if (runtime === 'mcp' || runtime === 'skill' || runtime === 'agent') return runtime;
  const capabilities = entry.capabilities ?? [];
  if (capabilities.includes('mcp')) return 'mcp';
  if (capabilities.includes('skill')) return 'skill';
  if (capabilities.includes('agent')) return 'agent';
  return 'plugin';
}

export function normalizeRepo(value?: string | null): string {
  if (!value) return '';
  return value
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
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

  const topics = Array.isArray(plugin.topics) ? plugin.topics.map((topic) => normalizedDiscoveryName(topic)) : [];
  if (topics.some((topic) => ['awesome', 'awesome-list', 'curated-list', 'resource-list'].includes(topic))) return true;

  const description = String(plugin.description || '').trim().toLowerCase();
  return /\b(awesome|curated)\s+(list|collection)\b/.test(description)
    || /\b(collection|directory|list)\s+of\s+(plugins?|tools?|resources?|projects?|agents?|skills?|mcp)\b/.test(description);
}

export function isHomePopular(plugin: MarketplacePlugin): boolean {
  const stars = Number(plugin.stars || 0);
  return isActivePlugin(plugin)
    && !isDiscoveryAggregator(plugin)
    && stars >= HOME_MIN_STARS
    && stars <= HOME_MAX_STARS
    && stars < HOME_HARD_MAX_STARS;
}

function recencyScore(updatedAt?: string): number {
  if (!updatedAt) return 0;
  const timestamp = Date.parse(updatedAt);
  if (!Number.isFinite(timestamp)) return 0;
  const days = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  if (days <= 7) return 1;
  if (days <= 30) return 0.75;
  if (days <= 90) return 0.45;
  if (days <= 180) return 0.2;
  return 0;
}

export function marketplaceScore(plugin: MarketplacePlugin): number {
  const stars = Math.max(HOME_MIN_STARS, Number(plugin.stars || 0));
  const starScore = Math.min(1, Math.log10(stars + 1) / Math.log10(HOME_MAX_STARS + 1));
  const trend = Math.max(0, Number(plugin.trend_score || 0));
  const trendScore = Math.min(1, Math.log10(trend + 1) / 3);
  const verifiedScore = plugin.verified ? 1 : 0;
  return starScore * 0.5 + trendScore * 0.2 + recencyScore(plugin.updated_at) * 0.2 + verifiedScore * 0.1;
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

export function buildRegistryRepoIndex(entries: RegistryEntry[]): Map<string, RegistryEntry[]> {
  const index = new Map<string, RegistryEntry[]>();
  for (const entry of entries) {
    const repo = normalizeRepo(entry.source?.repo);
    if (!repo) continue;
    const group = index.get(repo) ?? [];
    group.push(entry);
    group.sort((a, b) => String(b.version || '').localeCompare(String(a.version || '')));
    index.set(repo, group);
  }
  return index;
}

export function registryMatchesForPlugin(plugin: MarketplacePlugin, index: Map<string, RegistryEntry[]>): RegistryEntry[] {
  const repo = normalizeRepo(plugin.full_name || plugin.repo_url);
  return repo ? (index.get(repo) ?? []) : [];
}

export function primaryRegistryMatch(entries: RegistryEntry[]): RegistryEntry | null {
  return entries[0] ?? null;
}
