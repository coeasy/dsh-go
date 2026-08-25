import type { MarketplaceItem } from '../types';
import { validateMarketplaceItem } from './validator';

export interface SecurityScore {
  score: number;
  checks: string[];
  risks: string[];
}

export function calculateSecurityScore(item?: MarketplaceItem): SecurityScore {
  if (!item) return { score: 0, checks: [], risks: ['manifest is required'] };

  const trust = validateMarketplaceItem(item);
  const checks: string[] = [];
  let score = 0;

  if (/^(?:https:\/\/|git\+https:\/\/|npm:)/i.test(item.source.url)) {
    score += 15;
    checks.push('source:transport');
  }
  if (item.source.type !== 'github' || /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(item.source.commit ?? '')) {
    score += 25;
    checks.push('source:immutable');
  }
  if (item.artifact?.integrity?.startsWith('sha256-')) {
    score += 25;
    checks.push('artifact:integrity');
  }
  if (item.verified === true) {
    score += 15;
    checks.push('registry:verified');
  }
  if (item.capabilities.length > 0) {
    score += 10;
    checks.push('capabilities:declared');
  }
  if (new Set(item.dependencies.map((dependency) => dependency.id)).size === item.dependencies.length) {
    score += 10;
    checks.push('dependencies:deterministic');
  }

  return { score: trust.allowed ? Math.min(score, 100) : Math.min(score, 60), checks, risks: trust.reasons };
}
