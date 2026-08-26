import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export const REGISTRY_DISTRIBUTION_VERSION = 1;
export const REGISTRY_DISTRIBUTION_FORMAT = 'dsh-registry-distribution';

function sha256(content) {
  return createHash('sha256').update(String(content)).digest('hex');
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function registryContentHash(registry) {
  return sha256(stableStringify({
    registry_version: registry.registry_version,
    schema_version: registry.schema_version,
    defaults: registry.defaults,
    plugins: registry.plugins,
  }));
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return fallback;
    throw error;
  }
}

async function writeAtomic(file, content) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await writeFile(temp, content, 'utf8');
  await rename(temp, file);
}

function assertRelativeDistributionPath(path, label = 'path') {
  const value = String(path || '');
  const parts = value.split('/');
  if (!value
    || value.startsWith('/')
    || value.includes('\\')
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
    || parts.some((part) => !part || part === '.' || part === '..')) {
    const error = new Error(`unsafe Registry Distribution ${label}: ${value}`);
    error.code = 'DSH_REGISTRY_DISTRIBUTION_PATH';
    throw error;
  }
  return value;
}

export function isRegistryDistributionIndex(value) {
  return value?.format === REGISTRY_DISTRIBUTION_FORMAT
    && value?.distribution_version === REGISTRY_DISTRIBUTION_VERSION
    && value?.registry_version === 3
    && Array.isArray(value?.shards)
    && value?.registry_header?.registry_version === 3;
}

export function isRegistryDistributionSource(source) {
  const input = String(source || '').toLowerCase();
  return input.includes('/distribution-v1/')
    || input.endsWith('/distribution-v1')
    || input.endsWith('distribution-v1/index.json')
    || input.endsWith('distribution-index.json');
}

export function distributionCacheRoot(cacheFile) {
  return `${resolve(cacheFile)}.distribution-v1`;
}

function commandHeaders(extra = {}) {
  return { Accept: 'application/json', 'User-Agent': 'dsh-runtime-v3-distribution', ...extra };
}

function resolveChildSource(indexSource, relativePath) {
  const safePath = assertRelativeDistributionPath(relativePath, 'child path');
  if (/^https?:\/\//i.test(indexSource)) return new URL(safePath, indexSource).toString();
  return resolve(dirname(indexSource), safePath);
}

async function loadJsonSource(source, options = {}) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, {
      headers: commandHeaders(options.headers),
      signal: AbortSignal.timeout(options.timeout || 30000),
    });
    if (!response.ok) {
      const error = new Error(`Registry Distribution fetch failed: HTTP ${response.status}`);
      error.code = 'DSH_REGISTRY_DISTRIBUTION_FETCH';
      error.status = response.status;
      throw error;
    }
    return { value: await response.json(), response };
  }
  return { value: JSON.parse(await readFile(resolve(source), 'utf8')), response: null };
}

function validateIndex(index) {
  if (!isRegistryDistributionIndex(index)) throw new Error('invalid Registry Distribution index');
  if (!index.content_hash || !Number.isInteger(index.count) || index.count < 0) throw new Error('invalid Registry Distribution index metadata');
  const expectedShardCount = Number(index.shard_strategy?.count || index.shards.length);
  if (expectedShardCount !== index.shards.length) throw new Error('Registry Distribution shard count mismatch');
  const prefixes = new Set();
  for (const descriptor of index.shards) {
    if (!descriptor?.prefix || !descriptor?.path || !descriptor?.content_hash) throw new Error('invalid Registry Distribution shard descriptor');
    if (!/^[0-9a-f]{2}$/.test(descriptor.prefix)) throw new Error(`invalid Registry Distribution shard prefix: ${descriptor.prefix}`);
    const safePath = assertRelativeDistributionPath(descriptor.path, 'shard path');
    if (safePath !== `shards/${descriptor.prefix}.json`) throw new Error(`Registry Distribution shard path mismatch: ${descriptor.prefix}`);
    if (prefixes.has(descriptor.prefix)) throw new Error(`duplicate Registry Distribution shard: ${descriptor.prefix}`);
    prefixes.add(descriptor.prefix);
  }
  return index;
}

function validateShard(shard, descriptor) {
  if (shard?.format !== REGISTRY_DISTRIBUTION_FORMAT || shard?.distribution_version !== 1 || shard?.registry_version !== 3) {
    throw new Error(`invalid Registry Distribution shard: ${descriptor.prefix}`);
  }
  if (shard.prefix !== descriptor.prefix || !Array.isArray(shard.entries)) throw new Error(`Registry Distribution shard identity mismatch: ${descriptor.prefix}`);
  if (shard.entries.length !== descriptor.count) throw new Error(`Registry Distribution shard count mismatch: ${descriptor.prefix}`);
  const actualHash = sha256(stableStringify(shard.entries));
  if (actualHash !== descriptor.content_hash || shard.content_hash !== descriptor.content_hash) {
    const error = new Error(`Registry Distribution shard hash mismatch: ${descriptor.prefix}`);
    error.code = 'DSH_REGISTRY_DISTRIBUTION_INTEGRITY';
    throw error;
  }
  return shard;
}

function validatePackageRecord(record, descriptor) {
  if (record?.format !== REGISTRY_DISTRIBUTION_FORMAT || record?.distribution_version !== 1 || record?.registry_version !== 3) {
    throw new Error(`invalid Registry Distribution package record: ${descriptor.key}`);
  }
  if (record.key !== descriptor.key || !Array.isArray(record.entries)) throw new Error(`Registry Distribution package identity mismatch: ${descriptor.key}`);
  const packages = record.entries.map((entry) => entry.package);
  const actualHash = sha256(stableStringify(packages));
  if (actualHash !== descriptor.content_hash || record.content_hash !== descriptor.content_hash) {
    const error = new Error(`Registry Distribution package hash mismatch: ${descriptor.key}`);
    error.code = 'DSH_REGISTRY_DISTRIBUTION_INTEGRITY';
    throw error;
  }
  return record;
}

async function readIndexMetadata(root, source) {
  const metadata = await readJson(join(root, 'index.meta.json'));
  return metadata?.source === source ? metadata : null;
}

async function loadDistributionIndex(source, root, options = {}) {
  const indexFile = join(root, 'index.json');
  const metadataFile = join(root, 'index.meta.json');
  await mkdir(root, { recursive: true });

  if (!/^https?:\/\//i.test(source)) {
    const index = validateIndex(JSON.parse(await readFile(resolve(source), 'utf8')));
    return { index, changed: true, stale: false, responseEtag: null, responseLastModified: null };
  }

  const cached = await exists(indexFile);
  const metadata = cached ? await readIndexMetadata(root, source) : null;
  const headers = {};
  if (metadata?.etag) headers['If-None-Match'] = metadata.etag;
  if (metadata?.last_modified) headers['If-Modified-Since'] = metadata.last_modified;

  try {
    const response = await fetch(source, {
      headers: commandHeaders(headers),
      signal: AbortSignal.timeout(options.timeout || 30000),
    });
    if (response.status === 304) {
      if (!cached) throw new Error('Registry Distribution returned 304 without cached index');
      const index = validateIndex(JSON.parse(await readFile(indexFile, 'utf8')));
      await writeAtomic(metadataFile, `${JSON.stringify({
        ...metadata,
        source,
        content_hash: index.content_hash,
        checked_at: new Date().toISOString(),
      }, null, 2)}\n`);
      return { index, changed: false, stale: false, responseEtag: metadata?.etag || null, responseLastModified: metadata?.last_modified || null };
    }
    if (!response.ok) throw new Error(`Registry Distribution index fetch failed: HTTP ${response.status}`);
    const text = await response.text();
    const index = validateIndex(JSON.parse(text));
    await writeAtomic(indexFile, text.endsWith('\n') ? text : `${text}\n`);
    const etag = response.headers.get('etag') || null;
    const lastModified = response.headers.get('last-modified') || null;
    await writeAtomic(metadataFile, `${JSON.stringify({
      source,
      etag,
      last_modified: lastModified,
      content_hash: index.content_hash,
      fetched_at: new Date().toISOString(),
      checked_at: new Date().toISOString(),
    }, null, 2)}\n`);
    return { index, changed: metadata?.content_hash !== index.content_hash, stale: false, responseEtag: etag, responseLastModified: lastModified };
  } catch (error) {
    if (options.allowStale !== false && cached) {
      const index = validateIndex(JSON.parse(await readFile(indexFile, 'utf8')));
      return { index, changed: false, stale: true, responseEtag: metadata?.etag || null, responseLastModified: metadata?.last_modified || null };
    }
    throw error;
  }
}

async function loadShard(indexSource, root, descriptor, options = {}) {
  const file = join(root, 'shards', `${descriptor.prefix}.json`);
  if (await exists(file)) {
    try {
      return validateShard(JSON.parse(await readFile(file, 'utf8')), descriptor);
    } catch {
      // Corrupt or stale local shard: refetch from the authoritative source.
    }
  }
  const childSource = resolveChildSource(indexSource, descriptor.path);
  const { value } = await loadJsonSource(childSource, options);
  const shard = validateShard(value, descriptor);
  await writeAtomic(file, `${JSON.stringify(shard)}\n`);
  return shard;
}

async function mapConcurrently(items, concurrency, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await mapper(items[index], index);
    }
  }
  const workers = Math.max(1, Math.min(Number(concurrency) || 12, items.length || 1));
  await Promise.all(Array.from({ length: workers }, worker));
  return output;
}

export async function materializeRegistryDistribution(source, options = {}) {
  const cacheFile = resolve(options.cacheFile || 'registry-v3.json');
  const root = resolve(options.cacheRoot || distributionCacheRoot(cacheFile));
  const finalMetadataFile = join(root, 'materialized.meta.json');
  const previous = await readJson(finalMetadataFile);
  const indexState = await loadDistributionIndex(source, root, options);
  const { index } = indexState;

  if (!indexState.changed && previous?.source === source && previous?.content_hash === index.content_hash && await exists(cacheFile)) {
    await writeAtomic(finalMetadataFile, `${JSON.stringify({ ...previous, checked_at: new Date().toISOString(), stale_index: indexState.stale }, null, 2)}\n`);
    return { file: cacheFile, index, cache_hit: true, stale: indexState.stale };
  }

  const shards = await mapConcurrently(index.shards, options.shardConcurrency || 12, (descriptor) => loadShard(source, root, descriptor, options));
  const entries = shards.flatMap((shard) => shard.entries).sort((a, b) => Number(a.ordinal) - Number(b.ordinal));
  const ordinals = new Set();
  for (const entry of entries) {
    const ordinal = Number(entry?.ordinal);
    if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= index.count || ordinals.has(ordinal) || !entry?.package) {
      const error = new Error(`invalid Registry Distribution ordinal: ${entry?.ordinal}`);
      error.code = 'DSH_REGISTRY_DISTRIBUTION_INTEGRITY';
      throw error;
    }
    ordinals.add(ordinal);
  }
  const plugins = entries.map((entry) => entry.package);
  if (plugins.length !== index.count) throw new Error(`Registry Distribution materialized count mismatch: ${plugins.length} != ${index.count}`);

  const registry = {
    ...index.registry_header,
    plugins,
  };
  const actualHash = registryContentHash(registry);
  if (actualHash !== index.content_hash) {
    const error = new Error(`Registry Distribution materialized hash mismatch: ${actualHash} != ${index.content_hash}`);
    error.code = 'DSH_REGISTRY_DISTRIBUTION_INTEGRITY';
    throw error;
  }

  await writeAtomic(cacheFile, `${JSON.stringify(registry, null, 2)}\n`);
  await writeAtomic(finalMetadataFile, `${JSON.stringify({
    source,
    distribution_version: index.distribution_version,
    content_hash: index.content_hash,
    etag: indexState.responseEtag,
    last_modified: indexState.responseLastModified,
    materialized_at: new Date().toISOString(),
    checked_at: new Date().toISOString(),
    stale_index: indexState.stale,
    shard_count: index.shards.length,
    package_count: index.package_count,
  }, null, 2)}\n`);
  return { file: cacheFile, index, cache_hit: false, stale: indexState.stale };
}

export async function loadDistributedPackage(source, type, id, options = {}) {
  const cacheFile = resolve(options.cacheFile || 'registry-v3.json');
  const root = resolve(options.cacheRoot || distributionCacheRoot(cacheFile));
  const { index } = await loadDistributionIndex(source, root, options);
  const key = `${String(type || 'plugin').toLowerCase()}:${String(id || '').trim().toLowerCase()}`;
  const descriptor = index.packages?.[key];
  if (!descriptor) {
    const error = new Error(`Registry Distribution package not found: ${key}`);
    error.code = 'DSH_PACKAGE_NOT_FOUND';
    throw error;
  }
  const relativePath = assertRelativeDistributionPath(descriptor.path, 'package path');
  const objectHash = sha256(key);
  if (relativePath !== `packages/${objectHash.slice(0, 2)}/${objectHash}.json`) {
    const error = new Error(`Registry Distribution package path mismatch: ${key}`);
    error.code = 'DSH_REGISTRY_DISTRIBUTION_PATH';
    throw error;
  }
  const file = join(root, relativePath);
  if (await exists(file)) {
    try {
      return { index, record: validatePackageRecord(JSON.parse(await readFile(file, 'utf8')), { ...descriptor, key }), cache_hit: true };
    } catch {
      // Re-fetch corrupt/stale package cache.
    }
  }
  const childSource = resolveChildSource(source, relativePath);
  const { value } = await loadJsonSource(childSource, options);
  const record = validatePackageRecord(value, { ...descriptor, key });
  await writeAtomic(file, `${JSON.stringify(record)}\n`);
  return { index, record, cache_hit: false };
}
