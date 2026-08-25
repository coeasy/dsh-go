import type { MarketplaceItem } from '../types';

export interface TrustResult {
  allowed: boolean;
  reasons: string[];
}

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const INTEGRITY_PATTERN = /^sha256-[a-f0-9]{64}$/i;

function hasSafeSourceUrl(value: string): boolean {
  return /^(?:https:\/\/|git\+https:\/\/|npm:)/i.test(value);
}

export function validateMarketplaceItem(item: MarketplaceItem): TrustResult {
  const reasons: string[] = [];
  if (!item.id.trim()) reasons.push('missing id');
  if (!VERSION_PATTERN.test(item.version)) reasons.push('invalid semantic version');
  if (!item.source?.url || !hasSafeSourceUrl(item.source.url)) reasons.push('source must use https, git+https, or npm');
  if (item.source?.type === 'github' && !COMMIT_PATTERN.test(item.source.commit ?? '')) {
    reasons.push('github source must be pinned to an immutable commit');
  }
  if (item.artifact?.integrity && !INTEGRITY_PATTERN.test(item.artifact.integrity)) {
    reasons.push('artifact integrity must be sha256');
  }
  if (item.dependencies.some((dependency) => dependency.id === item.id)) {
    reasons.push('self dependency is not allowed');
  }
  const dependencyIds = item.dependencies.map((dependency) => dependency.id);
  if (new Set(dependencyIds).size !== dependencyIds.length) reasons.push('duplicate dependencies are not allowed');
  return { allowed: reasons.length === 0, reasons };
}
