import { MarketplaceInstallAdapter, type InstallResult } from './install-adapter';
import { MarketplaceSearchEngine } from './search-engine';
import type { MarketplaceItem } from './types';

export interface MarketplaceAPI {
  search(query: string): Promise<MarketplaceItem[]>;
  detail(id: string): Promise<MarketplaceItem | null>;
  install(id: string): Promise<InstallResult>;
}

export function marketplaceApi(
  items: MarketplaceItem[] = [],
  installer = new MarketplaceInstallAdapter(),
): MarketplaceAPI {
  const searchEngine = new MarketplaceSearchEngine();
  return {
    async search(query) {
      return searchEngine.search(items, { keyword: query });
    },
    async detail(id) {
      return items.find((item) => item.id === id) ?? null;
    },
    async install(id) {
      const item = items.find((entry) => entry.id === id);
      if (item) return installer.install({ id: item.id, version: item.version, channel: item.channel });
      const plan = { command: 'node' as const, argv: [], requiresLocalRuntime: true as const, restartRequired: true as const };
      return {
        success: false,
        planned: false,
        executed: false,
        restartRequired: false,
        requiresLocalRuntime: true,
        plan,
        reason: `marketplace item not found: ${id}`,
      };
    },
  };
}
