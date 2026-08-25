import { MarketplaceSearchEngine, type MarketplaceQuery } from '../../v1/search-engine';
import type { MarketplaceItem } from '../../v1/types';

export interface MarketplaceDashboardState {
  items: MarketplaceItem[];
  plugins: MarketplaceItem[];
  mcpServers: MarketplaceItem[];
  skills: MarketplaceItem[];
  agents: MarketplaceItem[];
  loading: boolean;
  error?: string;
}

function group(items: MarketplaceItem[]): Omit<MarketplaceDashboardState, 'items' | 'loading' | 'error'> {
  return {
    plugins: items.filter((item) => item.type === 'plugin'),
    mcpServers: items.filter((item) => item.type === 'mcp'),
    skills: items.filter((item) => item.type === 'skill'),
    agents: items.filter((item) => item.type === 'agent'),
  };
}

export function createMarketplaceDashboardState(items: MarketplaceItem[] = []): MarketplaceDashboardState {
  const normalized = [...items];
  return { items: normalized, ...group(normalized), loading: false };
}

export function filterMarketplaceDashboard(
  state: MarketplaceDashboardState,
  query: MarketplaceQuery,
): MarketplaceDashboardState {
  const items = new MarketplaceSearchEngine().search(state.items, query);
  return { ...state, items, ...group(items), loading: false, error: undefined };
}
