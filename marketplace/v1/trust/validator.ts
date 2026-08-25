import type { MarketplaceItem } from '../types';

export interface TrustResult {
  allowed: boolean;
  reasons: string[];
}

export function validateMarketplaceItem(item: MarketplaceItem): TrustResult {
  const reasons: string[] = [];

  if (!item.id) reasons.push('missing id');
  if (!item.version) reasons.push('missing version');
  if (!item.source?.url) reasons.push('missing source');

  return {
    allowed: reasons.length === 0,
    reasons,
  };
}
