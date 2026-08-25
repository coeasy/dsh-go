import type { MarketplaceItem } from './types';

export interface PluginVersion {
  version: string;
  source: string;
  checksum?: string;
  channel: string;
  commit?: string;
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

export function getPluginVersions(id: string, items: MarketplaceItem[] = []): PluginVersion[] {
  return items
    .filter((item) => item.id === id)
    .map((item) => ({
      version: item.version,
      source: item.source.url,
      checksum: item.artifact?.integrity,
      channel: item.channel,
      commit: item.source.commit,
    }))
    .sort((left, right) => compareVersions(right.version, left.version));
}
