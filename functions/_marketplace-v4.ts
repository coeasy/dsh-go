import type { RegistryV3Data, RegistryV3Plugin, ReleaseChannel } from './_registry';
import { ecosystemType } from './_registry';
import { compareSemanticVersions } from './_package-request';

export const MARKETPLACE_LOCALES = ['en', 'zh-CN', 'ja', 'ko', 'es'] as const;
export type MarketplaceLocale = typeof MARKETPLACE_LOCALES[number];

export interface LocalizationOverlay {
  schema_version: 1;
  locale: string;
  entries: Record<string, { name?: string; description?: string; summary?: string; category_label?: string }>;
}

export interface TrustResult {
  tier: 'unverified' | 'community' | 'verified' | 'trusted';
  score: number;
  publisher_verified: boolean;
  repository_ownership: string;
  evidence: { provenance: boolean; signature: boolean; sbom: boolean; license: boolean };
  security: { yanked: boolean; revoked: boolean; advisories: number };
}

export function normalizeLocale(value?: string | null): MarketplaceLocale {
  const raw = String(value || '').trim().replace('_', '-');
  const exact = MARKETPLACE_LOCALES.find((item) => item.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const language = raw.split('-')[0].toLowerCase();
  return MARKETPLACE_LOCALES.find((item) => item.split('-')[0].toLowerCase() === language) || 'en';
}

export function requestedLocale(request: Request): MarketplaceLocale {
  const url = new URL(request.url);
  const explicit = url.searchParams.get('locale');
  if (explicit) return normalizeLocale(explicit);
  const accept = request.headers.get('accept-language')?.split(',')[0]?.split(';')[0];
  return normalizeLocale(accept);
}

export async function loadLocalizationOverlay(env: { ASSETS: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> } }, requestUrl: string, locale: MarketplaceLocale): Promise<LocalizationOverlay | null> {
  try {
    const response = await env.ASSETS.fetch(new URL(`/catalog/localization-v1/${encodeURIComponent(locale)}.json`, requestUrl));
    if (!response.ok) return null;
    const overlay = await response.json() as LocalizationOverlay;
    if (overlay.schema_version !== 1 || !overlay.entries || typeof overlay.entries !== 'object') return null;
    return overlay;
  } catch {
    return null;
  }
}

export function trustFor(plugin: RegistryV3Plugin): TrustResult {
  const security: any = plugin.security || {};
  const publisher: any = plugin.publisher || {};
  const ownership = String(publisher.repository_ownership || 'unverified');
  const publisherVerified = ownership === 'verified' || publisher.verified === true;
  let score = 0;
  if (security.provenance) score += 20;
  if (security.signature) score += 25;
  if (security.sbom) score += 15;
  if (security.license) score += 10;
  if (publisherVerified) score += 25; else if (['declared', 'required'].includes(ownership)) score += 10;
  if (plugin.metadata?.verified === true) score += 10;
  if (security.yanked === true) score -= 25;
  if (security.revoked === true) score -= 100;
  const advisories = Array.isArray(security.advisories) ? security.advisories : [];
  const critical = advisories.some((item: any) => String(item?.severity || '').toLowerCase() === 'critical');
  if (critical) score -= 50;
  score = Math.max(0, Math.min(100, score));
  const tier: TrustResult['tier'] = security.revoked === true || critical ? 'unverified' : score >= 80 ? 'trusted' : score >= 55 ? 'verified' : score >= 25 ? 'community' : 'unverified';
  return {
    tier,
    score,
    publisher_verified: publisherVerified,
    repository_ownership: ownership,
    evidence: { provenance: Boolean(security.provenance), signature: Boolean(security.signature), sbom: Boolean(security.sbom), license: Boolean(security.license) },
    security: { yanked: security.yanked === true, revoked: security.revoked === true, advisories: advisories.length },
  };
}

export function popularityFor(plugin: RegistryV3Plugin): number {
  return Number(plugin.metadata?.stars || 0);
}

export function presentationFor(plugin: RegistryV3Plugin, overlay?: LocalizationOverlay | null) {
  const type = ecosystemType(plugin);
  const entry = overlay?.entries?.[`${type}:${plugin.id}`] || {};
  return {
    name: entry.name || plugin.metadata?.name || plugin.id,
    description: entry.description || plugin.metadata?.description || '',
    summary: entry.summary || null,
    category_label: entry.category_label || plugin.metadata?.category || null,
  };
}

export function publisherId(plugin: RegistryV3Plugin): string {
  const publisher: any = plugin.publisher || {};
  return String(publisher.id || publisher.login || publisher.name || plugin.source?.repo?.split('/')[0] || 'unknown');
}

export function packageDetailV2(plugin: RegistryV3Plugin, overlay?: LocalizationOverlay | null) {
  const type = ecosystemType(plugin);
  const channel = (plugin.channel || plugin.release_channel || 'stable') as ReleaseChannel;
  const presentation = presentationFor(plugin, overlay);
  const params = new URLSearchParams({ id: plugin.id, version: plugin.version, type });
  if (channel !== 'stable') params.set('channel', channel);
  return {
    identity: { key: `${type}:${plugin.id}`, id: plugin.id, type, version: plugin.version, channel, repo: plugin.source.repo, commit: plugin.source.commit, publisher: publisherId(plugin) },
    presentation,
    capabilities: plugin.capabilities || [],
    permissions: plugin.permissions || [],
    compatibility: (plugin as any).compatibility || {},
    dependencies: plugin.dependencies || [],
    trust: trustFor(plugin),
    popularity: popularityFor(plugin),
    security: plugin.security || null,
    local_install: {
      command: `dsh ${type} install ${plugin.id}@${plugin.version}`,
      deep_link: `dsh://install?${params.toString()}`,
      executed: false,
      requires_local_runtime: true,
      restart_required: true,
    },
  };
}

export function latestStableByKey(data: RegistryV3Data): Map<string, RegistryV3Plugin> {
  const result = new Map<string, RegistryV3Plugin>();
  for (const plugin of data.plugins) {
    if ((plugin.channel || plugin.release_channel || 'stable') !== 'stable') continue;
    if ((plugin.security as any)?.yanked === true || (plugin.security as any)?.revoked === true) continue;
    const key = `${ecosystemType(plugin)}:${plugin.id}`;
    const current = result.get(key);
    if (!current || compareSemanticVersions(plugin.version, current.version) > 0) result.set(key, plugin);
  }
  return result;
}

export function marketplaceHome(data: RegistryV3Data, overlay?: LocalizationOverlay | null, limit = 40) {
  return [...latestStableByKey(data).values()]
    .map((plugin) => packageDetailV2(plugin, overlay))
    .sort((a, b) => b.popularity - a.popularity || b.trust.score - a.trust.score || a.identity.key.localeCompare(b.identity.key))
    .slice(0, Math.max(1, Math.min(limit, 100)));
}

export function publisherSummary(data: RegistryV3Data, id: string, overlay?: LocalizationOverlay | null) {
  const packages = data.plugins.filter((plugin) => publisherId(plugin).toLowerCase() === id.toLowerCase()).map((plugin) => packageDetailV2(plugin, overlay));
  const latest = packages.filter((item) => item.identity.channel === 'stable');
  return {
    id,
    package_count: new Set(packages.map((item) => item.identity.key)).size,
    verified_packages: latest.filter((item) => item.trust.publisher_verified).length,
    trust: latest.length ? Math.round(latest.reduce((sum, item) => sum + item.trust.score, 0) / latest.length) : 0,
    packages,
  };
}
