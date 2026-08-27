export interface ProviderAdapterReleaseRecord {
  id: string;
  name: string;
  description?: string;
  version: string;
  kind: string;
  capabilities?: string[];
  release_id: string;
  artifact: { integrity: string; size: number; file_name: string; url?: string };
  release?: { channel?: string };
}

export interface ProviderAdapterGroup {
  id: string;
  name: string;
  description?: string;
  kind: string;
  channels: Record<string, string>;
  versions: ProviderAdapterReleaseRecord[];
}

export interface ProviderAdapterRegistry {
  registry_version: number;
  schema_version: string;
  generated: { at: string | null; count: number; release_count: number; content_hash: string };
  providers: ProviderAdapterGroup[];
}

export interface ProviderAdapterQuery {
  kind?: string;
  channel?: string;
  capability?: string;
  search?: string;
}

export async function loadProviderAdapterMarketplace(requestUrl: string): Promise<{ data: ProviderAdapterRegistry; etag: string }> {
  const assetUrl = new URL('/catalog/provider-adapters.json', requestUrl);
  const response = await fetch(assetUrl.toString(), { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`provider adapter registry asset returned ${response.status}`);
  const data = await response.json() as ProviderAdapterRegistry;
  if (data.registry_version !== 1 || data.schema_version !== '1.0.0' || !Array.isArray(data.providers)) {
    throw new Error('invalid provider adapter registry asset');
  }
  const etag = response.headers.get('etag') || `"${data.generated?.content_hash || 'provider-adapters'}"`;
  return { data, etag };
}

function releaseForChannel(group: ProviderAdapterGroup, channel = 'stable'): ProviderAdapterReleaseRecord | null {
  const version = group.channels?.[channel] || group.versions.at(-1)?.version;
  return group.versions.find((release) => release.version === version) || null;
}

export function filterProviderAdapters(groups: ProviderAdapterGroup[], query: ProviderAdapterQuery): ProviderAdapterGroup[] {
  const search = String(query.search || '').trim().toLowerCase();
  const capability = String(query.capability || '').trim().toLowerCase();
  return groups.filter((group) => {
    if (query.kind && group.kind !== query.kind) return false;
    if (query.channel && !group.channels?.[query.channel]) return false;
    const selected = releaseForChannel(group, query.channel || 'stable');
    if (capability && !(selected?.capabilities || []).some((value) => value.toLowerCase() === capability)) return false;
    if (search) {
      const values = [group.id, group.name, group.description || '', group.kind, ...(selected?.capabilities || [])];
      if (!values.some((value) => String(value).toLowerCase().includes(search))) return false;
    }
    return true;
  });
}

export function toProviderMarketplaceItem(group: ProviderAdapterGroup, channel = 'stable') {
  const selected = releaseForChannel(group, channel);
  return {
    id: group.id,
    name: group.name,
    description: group.description || '',
    kind: group.kind,
    channels: group.channels,
    latest_version: selected?.version || null,
    release_id: selected?.release_id || null,
    capabilities: selected?.capabilities || [],
    artifact: selected?.artifact || null,
  };
}
