import type { Env } from './_lib';
import type { PackageType, ReleaseChannel } from '../packages/protocol-core/index.mjs';

export interface RegistryV4Dependency {
  type: PackageType;
  id: string;
  range: string;
  optional?: boolean;
  channel?: ReleaseChannel;
}

export interface RegistryV4Release {
  version: string;
  channel: ReleaseChannel;
  commit: string;
  published_at?: string;
  dependencies: RegistryV4Dependency[];
  compatibility: Record<string, unknown>;
  permissions: string[];
  artifact: Record<string, unknown>;
  security: Record<string, any>;
  entrypoints?: Record<string, unknown>;
  capabilities?: string[];
  yanked: boolean;
  revoked: boolean;
}

export interface RegistryV4Package {
  type: PackageType;
  id: string;
  publisher_id: string;
  source: { provider?: string; repo?: string };
  metadata: Record<string, any>;
  releases: RegistryV4Release[];
}

export interface RegistryV4Data {
  schema_version: 4;
  generated_at: string;
  revision: string;
  packages: RegistryV4Package[];
  publishers: Array<Record<string, any>>;
  advisories: Array<Record<string, any>>;
  metadata: Record<string, any>;
}

export async function loadRegistryV4(env: Env, requestUrl = 'https://dsh-go.pages.dev'): Promise<{ data: RegistryV4Data; etag: string }> {
  const response = await env.ASSETS.fetch(new URL('/catalog/registry-v4.json', requestUrl));
  if (!response.ok) throw new Error(`Registry V4 load failed: ${response.status}`);
  const data = (await response.json()) as RegistryV4Data;
  if (data.schema_version !== 4 || !Array.isArray(data.packages) || typeof data.revision !== 'string' || !data.revision) {
    throw new Error('invalid Registry V4 payload');
  }
  const header = response.headers.get('etag')?.replace(/^W\//, '').replaceAll('"', '') ?? '';
  return { data, etag: data.revision || header };
}
