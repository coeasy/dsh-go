export const HOME_MIN_STARS = 100;
export const HOME_MAX_STARS = 5000;
export const HOME_HARD_MAX_STARS = 10000;
export const HOME_TOP_LIMIT = 100;

type MarketplacePlugin = {
  name?: string;
  full_name?: string;
  description?: string;
  category?: string;
  topics?: string[];
  tags?: string[];
  stars?: number;
  trend_score?: number;
  verified?: boolean;
  updated_at?: string;
};

type RegistryLike = {
  id?: string;
  version?: string;
  kind?: string;
  type?: string;
  source?: { repo?: string };
  metadata?: { name?: string; description?: string; stars?: number; verified?: boolean };
};

const AGGREGATOR_NAME_PATTERNS = [
  /^awesome[-_.]/i,
  /[-_.]awesome(?:[-_.]|$)/i,
  /(?:^|[-_.])(list|lists|directory|directories|collection|collections)(?:[-_.]|$)/i,
  /(?:^|[-_.])(marketplace|marketplaces|catalog|catalogue|registry|registries)(?:[-_.]|$)/i,
];

const AGGREGATOR_DESCRIPTION_PATTERNS = [
  /curated\s+(?:list|collection|directory)/i,
  /awesome\s+(?:list|collection)/i,
  /list\s+of\s+(?:awesome\s+)?(?:mcp|plugin|skill|agent|tool|server)/i,
  /directory\s+of\s+(?:mcp|plugin|skill|agent|tool|server)/i,
  /collection\s+of\s+(?:mcp|plugin|skill|agent|tool|server)/i,
];

const AGGREGATOR_TOPICS = new Set([
  'awesome-list',
  'awesome-lists',
  'curated-list',
  'directory',
  'marketplace',
  'catalog',
  'catalogue',
  'registry',
]);

function normalizedText(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

export function normalizeRepo(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[#/?].*)?$/i);
  const repo = match ? `${match[1]}/${match[2]}` : raw.replace(/^github:/i, '').replace(/^\/+|\/+$/g, '');
  const parts = repo.split('/').filter(Boolean);
  if (parts.length !== 2) return '';
  return `${parts[0].toLowerCase()}/${parts[1].toLowerCase()}`;
}

export function isDiscoveryAggregator(plugin: MarketplacePlugin) {
  const name = normalizedText(plugin.name || plugin.full_name);
  const description = normalizedText(plugin.description);
  const topics = [...(plugin.topics || []), ...(plugin.tags || [])].map(normalizedText);

  if (AGGREGATOR_NAME_PATTERNS.some((pattern) => pattern.test(name))) return true;
  if (AGGREGATOR_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(description))) return true;
  return topics.some((topic) => AGGREGATOR_TOPICS.has(topic));
}

export function isHomePopular(plugin: MarketplacePlugin) {
  const stars = Number(plugin.stars || 0);
  return stars >= HOME_MIN_STARS && stars <= HOME_MAX_STARS && !isDiscoveryAggregator(plugin);
}

export function marketplaceUpdatedAtTimestamp(updatedAt?: string) {
  const parsed = Date.parse(String(updatedAt || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function recencyScore(updatedAt?: string) {
  const timestamp = marketplaceUpdatedAtTimestamp(updatedAt);
  if (!timestamp) return 0;
  const days = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  if (days <= 7) return 1;
  if (days <= 30) return 0.75;
  if (days <= 90) return 0.45;
  if (days <= 180) return 0.2;
  return 0;
}

function marketplaceQualityScore(plugin: MarketplacePlugin) {
  const stars = Math.max(0, Number(plugin.stars || 0));
  const trend = Math.max(0, Number(plugin.trend_score || 0));
  const starScore = Math.min(1, Math.log10(stars + 1) / Math.log10(HOME_MAX_STARS + 1));
  const trendScore = Math.min(1, Math.log10(trend + 1) / 4);
  return starScore * 0.5 + trendScore * 0.2 + recencyScore(plugin.updated_at) * 0.2 + (plugin.verified ? 0.1 : 0);
}

/**
 * Homepage ranking key. Repository freshness is the primary ordering signal;
 * the previous stars/trend/recency/verified quality score remains as a stable
 * fractional tie-breaker. Multiplying the millisecond timestamp by two means
 * even a 1 ms newer update wins over the full quality-score range.
 */
export function marketplaceScore(plugin: MarketplacePlugin) {
  return marketplaceUpdatedAtTimestamp(plugin.updated_at) * 2 + marketplaceQualityScore(plugin);
}

export function selectHomeTop100<T extends MarketplacePlugin>(plugins: T[]) {
  return plugins
    .filter(isHomePopular)
    .map((plugin) => ({ plugin, score: marketplaceScore(plugin) }))
    .sort((left, right) =>
      right.score - left.score ||
      Number(right.plugin.stars || 0) - Number(left.plugin.stars || 0) ||
      String(left.plugin.name || left.plugin.full_name || '').localeCompare(String(right.plugin.name || right.plugin.full_name || ''))
    )
    .slice(0, HOME_TOP_LIMIT)
    .map(({ plugin }) => plugin);
}

export function ecosystemType(entry: RegistryLike) {
  const raw = String(entry.kind || entry.type || '').toLowerCase();
  if (raw === 'mcp' || raw === 'skill' || raw === 'agent' || raw === 'plugin') return raw;
  if (raw === 'mcp-server' || raw === 'mcp_server') return 'mcp';
  return 'plugin';
}

export function compareRegistryVersionsDesc(left: RegistryLike, right: RegistryLike) {
  return String(right.version || '').localeCompare(String(left.version || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

export function buildRegistryRepoIndex(entries: RegistryLike[]) {
  const index = new Map<string, RegistryLike[]>();
  for (const entry of entries || []) {
    const repo = normalizeRepo(entry.source?.repo);
    if (!repo) continue;
    const group = index.get(repo) || [];
    group.push(entry);
    index.set(repo, group);
  }
  for (const group of index.values()) group.sort(compareRegistryVersionsDesc);
  return index;
}

export function registryMatchesForPlugin(plugin: MarketplacePlugin, index: Map<string, RegistryLike[]>) {
  const repo = normalizeRepo(plugin.full_name);
  return repo ? index.get(repo) || [] : [];
}

export function primaryRegistryMatch(entries: RegistryLike[]) {
  if (!entries?.length) return null;
  return [...entries].sort((left, right) => {
    const typeOrder = { plugin: 0, mcp: 1, skill: 2, agent: 3 } as Record<string, number>;
    const typeDelta = (typeOrder[ecosystemType(left)] ?? 9) - (typeOrder[ecosystemType(right)] ?? 9);
    if (typeDelta !== 0) return typeDelta;
    return compareRegistryVersionsDesc(left, right);
  })[0];
}
