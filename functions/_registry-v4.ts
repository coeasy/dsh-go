import type { Env } from './_lib';
import type {
  RegistryV4,
  RegistryV4Dependency as CanonicalRegistryV4Dependency,
  RegistryV4Package as CanonicalRegistryV4Package,
  RegistryV4Release as CanonicalRegistryV4Release,
} from '../packages/registry-core/index.mjs';

export type RegistryV4Dependency = CanonicalRegistryV4Dependency;
export type RegistryV4Release = CanonicalRegistryV4Release;
export type RegistryV4Package = CanonicalRegistryV4Package;
export type RegistryV4Data = RegistryV4;

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
