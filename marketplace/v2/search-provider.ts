import type { EcosystemPackageV2, EcosystemType } from './types';

export interface SearchQuery {
  q?: string;
  type?: EcosystemType;
  verified?: boolean;
  limit?: number;
}

export interface SearchResult {
  items: EcosystemPackageV2[];
  total: number;
  provider: 'static' | 'kv' | 'd1';
}

export interface MarketplaceSearchProvider {
  search(query: SearchQuery): Promise<SearchResult>;
}

function searchable(item: EcosystemPackageV2): string {
  return [item.id, item.metadata?.name, item.metadata?.description, item.metadata?.category, item.source.repo, ...(item.capabilities || []), ...(item.provides || [])]
    .filter(Boolean).join(' ').toLowerCase();
}

export class StaticRegistrySearchProvider implements MarketplaceSearchProvider {
  constructor(private readonly items: EcosystemPackageV2[]) {}

  async search(query: SearchQuery): Promise<SearchResult> {
    const keyword = String(query.q || '').trim().toLowerCase();
    const limit = Math.max(1, Math.min(Number(query.limit || 50), 200));
    const filtered = this.items.filter((item) => {
      if (query.type && item.type !== query.type) return false;
      if (query.verified === true && item.metadata?.verified !== true) return false;
      return !keyword || searchable(item).includes(keyword);
    });
    filtered.sort((left, right) => Number(right.metadata?.stars || 0) - Number(left.metadata?.stars || 0) || left.id.localeCompare(right.id));
    return { items: filtered.slice(0, limit), total: filtered.length, provider: 'static' };
  }
}

export interface EdgeIndexAdapter {
  search(query: SearchQuery): Promise<EcosystemPackageV2[]>;
  count(query: SearchQuery): Promise<number>;
}

export class EdgeSearchProvider implements MarketplaceSearchProvider {
  constructor(private readonly adapter: EdgeIndexAdapter, private readonly provider: 'kv' | 'd1') {}
  async search(query: SearchQuery): Promise<SearchResult> {
    const [items, total] = await Promise.all([this.adapter.search(query), this.adapter.count(query)]);
    return { items, total, provider: this.provider };
  }
}
