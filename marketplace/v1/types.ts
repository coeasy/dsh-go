export type MarketplaceItemType =
  | 'plugin'
  | 'mcp'
  | 'skill'
  | 'agent';

export interface MarketplaceItem {
  id: string;
  type: MarketplaceItemType;
  version: string;
  description?: string;
  source: {
    type: 'github' | 'npm' | 'custom';
    url: string;
  };
  runtime?: {
    dsh?: string;
  };
}
