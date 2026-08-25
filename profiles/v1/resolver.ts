import type { MarketplaceItem } from '../../marketplace/v1/types';
import type { BundleManifest, ProfileManifest, ProfileResolutionIssue } from './types';

export interface ProfileResolution {
  name: string;
  valid: boolean;
  items: MarketplaceItem[];
  issues: ProfileResolutionIssue[];
}

function versionParts(version: string): number[] {
  return version.split('-')[0].split('.').map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return left.localeCompare(right);
}

export function resolveProfile(profile: ProfileManifest, registry: MarketplaceItem[]): ProfileResolution {
  const issues: ProfileResolutionIssue[] = [];
  const selected = new Map<string, MarketplaceItem>();
  const requests = new Map<string, { version: string; channel?: string }>();

  for (const request of profile.items) {
    const version = request.version ?? '*';
    const previous = requests.get(request.id);
    if (previous && (previous.version !== version || previous.channel !== request.channel)) {
      issues.push({ id: request.id, reason: 'profile contains incompatible duplicate requests' });
      continue;
    }
    requests.set(request.id, { version, channel: request.channel });

    const candidates = registry
      .filter((item) => item.id === request.id)
      .filter((item) => !request.channel || item.channel === request.channel)
      .filter((item) => version === '*' || item.version === version)
      .sort((left, right) => compareVersions(right.version, left.version));
    const match = candidates[0];
    if (!match) {
      if (!request.optional) issues.push({ id: request.id, reason: `no marketplace version matches ${version}` });
      continue;
    }
    selected.set(request.id, match);
  }

  return { name: profile.name, valid: issues.length === 0, items: [...selected.values()], issues };
}

export function resolveBundle(bundle: BundleManifest, registry: MarketplaceItem[]): ProfileResolution {
  return resolveProfile(bundle, registry);
}
