export interface MarketplaceAPI {
  search(query: string): Promise<unknown[]>;
  detail(id: string): Promise<unknown | null>;
  install(id: string): Promise<{ success: boolean; restartRequired: boolean }>;
}

export const marketplaceApi = (): MarketplaceAPI => ({
  async search() { return []; },
  async detail() { return null; },
  async install() { return { success: true, restartRequired: true }; }
});
