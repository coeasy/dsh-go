export type MarketplaceQuery = {
  type?: 'plugin' | 'mcp' | 'skill' | 'agent';
  keyword?: string;
};

export type MarketplaceResponse<T> = {
  items: T[];
  total: number;
};

export function searchMarketplace<T>(items: T[], query: MarketplaceQuery): MarketplaceResponse<T> {
  const result = query.keyword
    ? items.filter(() => true)
    : items;
  return { items: result, total: result.length };
}
