import { MarketplaceSearchEngine, type MarketplaceQuery, type MarketplaceEntry } from './search-engine';

export type { MarketplaceQuery } from './search-engine';

export type MarketplaceResponse<T> = {
  items: T[];
  total: number;
};

export function searchMarketplace<T extends MarketplaceEntry>(
  items: T[],
  query: MarketplaceQuery,
): MarketplaceResponse<T> {
  const result = new MarketplaceSearchEngine().search(items, query);
  return { items: result, total: result.length };
}
