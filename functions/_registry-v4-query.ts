import {
  compareVersion,
  normalizePackageId,
  normalizePackageType,
  packageKey,
} from '../packages/protocol-core/index.mjs';
import type { RegistryV4Data, RegistryV4Package, RegistryV4Release } from './_registry-v4';

export function registryKey(type: unknown, id: unknown): string {
  return packageKey(normalizePackageType(type), normalizePackageId(id));
}

export function findRegistryPackage(registry: RegistryV4Data, type: unknown, id: unknown): RegistryV4Package | null {
  const key = registryKey(type, id);
  return registry.packages.find((pkg) => packageKey(pkg.type, pkg.id) === key) || null;
}

export function sortedReleases(pkg: RegistryV4Package): RegistryV4Release[] {
  return [...pkg.releases].sort((left, right) => compareVersion(right.version, left.version));
}

export function publicPackage(pkg: RegistryV4Package) {
  const releases = sortedReleases(pkg);
  const safe = releases.find((release) => release.channel === 'stable' && !release.revoked && !release.yanked)
    || releases.find((release) => !release.revoked && !release.yanked)
    || null;
  return {
    key: packageKey(pkg.type, pkg.id),
    type: pkg.type,
    id: pkg.id,
    publisher_id: pkg.publisher_id,
    source: pkg.source,
    metadata: pkg.metadata,
    latest_release: safe ? {
      version: safe.version,
      channel: safe.channel,
      commit: safe.commit,
      published_at: safe.published_at || null,
      yanked: safe.yanked,
      revoked: safe.revoked,
    } : null,
    release_count: releases.length,
  };
}

export function searchRegistry(registry: RegistryV4Data, query: string, type?: string, limit = 50) {
  const q = query.trim().toLowerCase();
  const normalizedType = type ? normalizePackageType(type) : null;
  return registry.packages
    .filter((pkg) => !normalizedType || pkg.type === normalizedType)
    .filter((pkg) => {
      if (!q) return true;
      const values = [pkg.id, pkg.publisher_id, pkg.source?.repo, pkg.metadata?.name, pkg.metadata?.description, pkg.metadata?.category];
      return values.some((value) => String(value || '').toLowerCase().includes(q));
    })
    .sort((left, right) => Number(right.metadata?.stars || 0) - Number(left.metadata?.stars || 0) || packageKey(left.type, left.id).localeCompare(packageKey(right.type, right.id)))
    .slice(0, Math.min(Math.max(1, limit), 200))
    .map(publicPackage);
}
