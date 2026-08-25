export interface MarketplaceQuery {
  keyword?: string;
  type?: 'plugin' | 'mcp' | 'skill' | 'agent';
}

export interface MarketplaceEntry {
  id: string;
  name: string;
  type: string;
  version: string;
}

export class MarketplaceSearchEngine {
  search(entries: MarketplaceEntry[], query: MarketplaceQuery): MarketplaceEntry[] {
    return entries.filter((entry) => {
      const keywordMatch = !query.keyword || entry.name.includes(query.keyword);
      const typeMatch = !query.type || entry.type === query.type;
      return keywordMatch && typeMatch;
    });
  }
}
