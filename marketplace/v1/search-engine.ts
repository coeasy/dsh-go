import type { MarketplaceItemType, ReleaseChannel } from './types';

export interface MarketplaceQuery {
  keyword?: string;
  type?: MarketplaceItemType;
  channel?: ReleaseChannel;
  capability?: string;
  verified?: boolean;
}

export interface MarketplaceEntry {
  id: string;
  name: string;
  type: string;
  version: string;
  channel?: string;
  description?: string;
  capabilities?: string[];
  verified?: boolean;
}

function text(value: string | undefined): string {
  return (value ?? '').toLocaleLowerCase();
}

export class MarketplaceSearchEngine {
  search<T extends MarketplaceEntry>(entries: T[], query: MarketplaceQuery): T[] {
    const keyword = text(query.keyword).trim();
    const capability = text(query.capability).trim();

    return entries
      .filter((entry) => {
        const keywordMatch = !keyword
          || [entry.id, entry.name, entry.description]
            .some((value) => text(value).includes(keyword));
        const typeMatch = !query.type || entry.type === query.type;
        const channelMatch = !query.channel || (entry.channel ?? 'stable') === query.channel;
        const capabilityMatch = !capability
          || (entry.capabilities ?? []).some((value) => text(value) === capability);
        const verifiedMatch = query.verified === undefined || entry.verified === query.verified;
        return keywordMatch && typeMatch && channelMatch && capabilityMatch && verifiedMatch;
      })
      .sort((left, right) => {
        if (!keyword) return left.id.localeCompare(right.id);
        const leftExact = text(left.id) === keyword || text(left.name) === keyword;
        const rightExact = text(right.id) === keyword || text(right.name) === keyword;
        if (leftExact !== rightExact) return leftExact ? -1 : 1;
        const leftPrefix = text(left.id).startsWith(keyword) || text(left.name).startsWith(keyword);
        const rightPrefix = text(right.id).startsWith(keyword) || text(right.name).startsWith(keyword);
        if (leftPrefix !== rightPrefix) return leftPrefix ? -1 : 1;
        return left.id.localeCompare(right.id);
      });
  }
}
