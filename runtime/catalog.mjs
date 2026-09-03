import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  isRegistryDistributionSource,
  materializeRegistryDistribution,
} from './registry-distribution.mjs';

export const DEFAULT_REGISTRY_URL = 'https://coeasy.github.io/dsh-go/catalog/registry-v3.json';
export const DEFAULT_DISTRIBUTION_URL = 'https://coeasy.github.io/dsh-go/catalog/distribution-v1/index.json';

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

export function registryCacheFile() {
  return process.env.DSH_REGISTRY_CACHE || join(homedir(), '.dsh', 'cache', 'registry-v3.json');
}

export function registryCacheMetadataFile(cacheFile = registryCacheFile()) {
  return `${resolve(cacheFile)}.meta.json`;
}

async function readCacheMetadata(file, source) {
  try {
    const metadata = JSON.parse(await readFile(file, 'utf8'));
    return metadata?.source === source ? metadata : null;
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeAtomic(file, content) {
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, content, 'utf8');
  await rename(temp, file);
}

async function ensureLegacyRegistryCache(resolvedSource, options = {}) {
  if (!/^https?:\/\//i.test(resolvedSource)) return resolve(resolvedSource);
  const file = resolve(options.cacheFile || registryCacheFile());
  const metadataFile = resolve(options.metadataFile || registryCacheMetadataFile(file));
  await mkdir(dirname(file), { recursive: true });

  try {
    const cached = await exists(file);
    const metadata = cached ? await readCacheMetadata(metadataFile, resolvedSource) : null;
    const headers = { Accept: 'application/json', 'User-Agent': 'dsh-runtime-v3', ...(options.headers || {}) };
    if (metadata?.etag) headers['If-None-Match'] = metadata.etag;
    if (metadata?.last_modified) headers['If-Modified-Since'] = metadata.last_modified;

    const response = await fetch(resolvedSource, {
      headers,
      signal: AbortSignal.timeout(options.timeout || 30000),
    });

    if (response.status === 304) {
      if (!cached) throw new Error('registry server returned 304 without a local cache');
      await writeAtomic(metadataFile, `${JSON.stringify({
        ...metadata,
        source: resolvedSource,
        checked_at: new Date().toISOString(),
      }, null, 2)}\n`);
      return file;
    }

    if (!response.ok) throw new Error(`registry fetch failed: HTTP ${response.status}`);
    const text = await response.text();
    const parsed = JSON.parse(text);
    if (parsed?.registry_version !== 3 || !Array.isArray(parsed?.plugins)) throw new Error('remote registry is not Registry V3');

    await writeAtomic(file, text.endsWith('\n') ? text : `${text}\n`);
    await writeAtomic(metadataFile, `${JSON.stringify({
      source: resolvedSource,
      mode: 'legacy-full-registry',
      content_hash: parsed.generated?.content_hash || null,
      etag: response.headers.get('etag') || null,
      last_modified: response.headers.get('last-modified') || null,
      fetched_at: new Date().toISOString(),
      checked_at: new Date().toISOString(),
    }, null, 2)}\n`);
    return file;
  } catch (error) {
    if (options.allowStale !== false && await exists(file)) return file;
    throw error;
  }
}

export async function loadRegistrySource(source, options = {}) {
  const file = await ensureRegistryCache(source, options);
  const data = JSON.parse(await readFile(file, 'utf8'));
  if (data?.registry_version !== 3 || !Array.isArray(data?.plugins)) throw new Error('registry source is not Registry V3');
  return data;
}

export async function resolveRegistrySource(explicit) {
  if (explicit) return explicit;
  if (process.env.DSH_CATALOG_REGISTRY) return process.env.DSH_CATALOG_REGISTRY;
  if (process.env.DSH_REGISTRY) return process.env.DSH_REGISTRY;
  const cwdRegistry = resolve(process.cwd(), 'catalog/registry-v3.json');
  if (await exists(cwdRegistry)) return cwdRegistry;
  return process.env.DSH_REGISTRY_DISTRIBUTION_URL
    || process.env.DSH_REGISTRY_URL
    || DEFAULT_DISTRIBUTION_URL;
}

export async function ensureRegistryCache(source, options = {}) {
  const resolvedSource = await resolveRegistrySource(source);
  const file = resolve(options.cacheFile || registryCacheFile());

  if (isRegistryDistributionSource(resolvedSource)) {
    try {
      const result = await materializeRegistryDistribution(resolvedSource, {
        ...options,
        cacheFile: file,
      });
      await mkdir(dirname(file), { recursive: true });
      await writeAtomic(registryCacheMetadataFile(file), `${JSON.stringify({
        source: resolvedSource,
        mode: 'distribution-v1',
        content_hash: result.index.content_hash,
        distribution_version: result.index.distribution_version,
        shard_count: result.index.shards.length,
        package_count: result.index.package_count,
        cache_hit: result.cache_hit,
        stale: result.stale,
        checked_at: new Date().toISOString(),
      }, null, 2)}\n`);
      return result.file;
    } catch (distributionError) {
      if (options.allowLegacyFallback === false) throw distributionError;
      const legacySource = options.legacySource || process.env.DSH_LEGACY_REGISTRY_URL || DEFAULT_REGISTRY_URL;
      try {
        return await ensureLegacyRegistryCache(legacySource, { ...options, cacheFile: file });
      } catch (legacyError) {
        legacyError.cause = distributionError;
        throw legacyError;
      }
    }
  }

  return ensureLegacyRegistryCache(resolvedSource, { ...options, cacheFile: file });
}
