export interface MarketplaceDashboardState {
  plugins: unknown[];
  mcpServers: unknown[];
  skills: unknown[];
  agents: unknown[];
  loading: boolean;
}

export function createMarketplaceDashboardState(): MarketplaceDashboardState {
  return {
    plugins: [],
    mcpServers: [],
    skills: [],
    agents: [],
    loading: false,
  };
}
