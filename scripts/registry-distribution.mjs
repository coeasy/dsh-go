#!/usr/bin/env node
/**
 * Physical Registry V3 distribution layer.
 *
 * Registry V3 remains the logical data contract. This module only changes how
 * the registry is published: one compact index, 256 deterministic shards,
 * package-level records, and a delta manifest. Generated distribution files are
 * build artifacts and intentionally do not live in Git history.
 */
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, stableStringify } from './checksum.mjs';

export const DISTRIBUTION_VERSION = 1;
export const DISTRIBUTION_SHARD_COUNT = 256;
export const DISTRIBUTION_PREFIX_CHARS = 2;
export const DISTRIBUTION_FORMAT = 'dsh-registry-distribution';

function inferPackageType(record) {
  const type = String(record?.runtime?.type || 'plugin').toLowerCase();
  return ['plugin', 'mcp', 'skill', 'agent'].includes(type) ? type : 'plugin';
}

export function distributionPackageKey(recordOrType, maybeId) {
  if (typeof recordOrType === 'string') {
    return `${String(recordOrType || 'plugin').toLowerCase()}:${String(maybeId || '').trim().toLowerCase()}`;
  }
  return `${inferPackageType(recordOrType)}:${String(recordOrType?.id || '').trim().toLowerCase()}`;
}

export function distributionPackageHash(key) {
  return sha256(String(key));
}

export function distributionShardPrefix(key) {
  return distributionPackageHash(key).slice(0, DISTRIBUTION_PREFIX_CHARS);
}

function semanticEtag(hash) {
  return `"sha256-${hash}"`;
}

function validateRegistryInput(registry) {
  if (registry?.registry_version !== 3 || !Array.isArray(registry?.plugins)) {
    throw new Error('Registry Distribution requires Registry V3');
  }
  if (!registry?.generated?.content_hash) {
    throw new Error('Registry Distribution requires registry.generated.content_hash');
  }
}

function packageGroups(registry) {
  const groups = new Map();
  registry.plugins.forEach((record, ordinal) => {
    const key = distributionPackageKey(record);
    const current = groups.get(key) || {
      key,
      type: inferPackageType(record),
      id: record.id,
      entries: [],
    };
    current.entries.push({ ordinal, package: record });
    groups.set(key, current);
  });
  return groups;
}

function packageDescriptor(group) {
  const records = group.entries.map((entry) => entry.package);
  const contentHash = sha256(stableStringify(records));
  const objectHash = distributionPackageHash(group.key);
  const prefix = objectHash.slice(0, DISTRIBUTION_PREFIX_CHARS);
  return {
    key: group.key,
    type: group.type,
    id: group.id,
    object_hash: objectHash,
    prefix,
    path: `packages/${prefix}/${objectHash}.json`,
    content_hash: contentHash,
    etag: semanticEtag(contentHash),
    versions: records.map((record) => String(record.version || '0.1.0')),
    count: records.length,
    ordinals: group.entries.map((entry) => entry.ordinal),
  };
}

export function buildDistributionDelta(registry, previousRegistry = null) {
  validateRegistryInput(registry);
  const currentGroups = packageGroups(registry);
  const previousGroups = previousRegistry?.registry_version === 3 && Array.isArray(previousRegistry?.plugins)
    ? packageGroups(previousRegistry)
    : new Map();
  const currentHashes = new Map([...currentGroups.entries()].map(([key, group]) => [key, packageDescriptor(group).content_hash]));
  const previousHashes = new Map([...previousGroups.entries()].map(([key, group]) => [key, packageDescriptor(group).content_hash]));

  const changed = [];
  for (const [key, contentHash] of [...currentHashes.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (previousHashes.get(key) !== contentHash) changed.push({ key, content_hash: contentHash });
  }
  const removed = [...previousHashes.keys()].filter((key) => !currentHashes.has(key)).sort();
  const fromHash = previousRegistry?.generated?.content_hash || null;
  const toHash = registry.generated.content_hash;
  const payloadHash = sha256(stableStringify({ fromHash, toHash, changed, removed }));

  return {
    format: DISTRIBUTION_FORMAT,
    distribution_version: DISTRIBUTION_VERSION,
    registry_version: 3,
    from_content_hash: fromHash,
    to_content_hash: toHash,
    generated_at: registry.generated.at || new Date().toISOString(),
    content_hash: payloadHash,
    etag: semanticEtag(payloadHash),
    changed,
    removed,
    counts: {
      changed: changed.length,
      removed: removed.length,
      current_packages: currentGroups.size,
    },
  };
}

export function buildRegistryDistribution(registry, options = {}) {
  validateRegistryInput(registry);
  const groups = packageGroups(registry);
  const descriptors = new Map();
  const shardEntries = new Map(Array.from({ length: DISTRIBUTION_SHARD_COUNT }, (_, index) => [index.toString(16).padStart(2, '0'), []]));

  for (const [key, group] of groups) {
    const descriptor = packageDescriptor(group);
    descriptors.set(key, descriptor);
    const shardPrefix = distributionShardPrefix(key);
    const shard = shardEntries.get(shardPrefix);
    for (const entry of group.entries) shard.push(entry);
  }

  const shards = [];
  const shardFiles = new Map();
  for (const [prefix, entries] of shardEntries) {
    entries.sort((a, b) => a.ordinal - b.ordinal);
    const contentHash = sha256(stableStringify(entries));
    const payload = {
      format: DISTRIBUTION_FORMAT,
      distribution_version: DISTRIBUTION_VERSION,
      registry_version: 3,
      prefix,
      count: entries.length,
      content_hash: contentHash,
      etag: semanticEtag(contentHash),
      entries,
    };
    const text = `${JSON.stringify(payload)}\n`;
    shardFiles.set(prefix, text);
    shards.push({
      prefix,
      path: `shards/${prefix}.json`,
      count: entries.length,
      content_hash: contentHash,
      etag: payload.etag,
      bytes: Buffer.byteLength(text),
    });
  }

  const packages = {};
  const packageFiles = new Map();
  for (const [key, descriptor] of [...descriptors.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const group = groups.get(key);
    packages[key] = descriptor;
    const payload = {
      format: DISTRIBUTION_FORMAT,
      distribution_version: DISTRIBUTION_VERSION,
      registry_version: 3,
      key,
      type: descriptor.type,
      id: descriptor.id,
      count: descriptor.count,
      content_hash: descriptor.content_hash,
      etag: descriptor.etag,
      entries: group.entries,
    };
    packageFiles.set(descriptor.path, `${JSON.stringify(payload)}\n`);
  }

  const suppliedDelta = options.delta;
  const delta = suppliedDelta?.to_content_hash === registry.generated.content_hash
    ? suppliedDelta
    : buildDistributionDelta(registry, options.previousRegistry || null);

  const registryHeader = {
    registry_version: registry.registry_version,
    schema_version: registry.schema_version,
    defaults: registry.defaults || {},
    generated: registry.generated || {},
  };
  const indexPayload = {
    format: DISTRIBUTION_FORMAT,
    distribution_version: DISTRIBUTION_VERSION,
    registry_version: 3,
    schema_version: registry.schema_version,
    generated_at: registry.generated.at || new Date().toISOString(),
    content_hash: registry.generated.content_hash,
    etag: semanticEtag(registry.generated.content_hash),
    count: registry.plugins.length,
    package_count: groups.size,
    registry_header: registryHeader,
    legacy: {
      path: '../registry-v3.json',
      content_hash: registry.generated.content_hash,
      count: registry.plugins.length,
    },
    shard_strategy: {
      algorithm: 'sha256',
      prefix_chars: DISTRIBUTION_PREFIX_CHARS,
      count: DISTRIBUTION_SHARD_COUNT,
      path_template: 'shards/{prefix}.json',
    },
    shards,
    package_strategy: {
      algorithm: 'sha256',
      key_format: '<type>:<lowercase-id>',
      path_template: 'packages/{prefix}/{sha256(key)}.json',
    },
    packages,
    delta: {
      path: 'delta.json',
      from_content_hash: delta.from_content_hash,
      to_content_hash: delta.to_content_hash,
      content_hash: delta.content_hash,
      changed: delta.counts?.changed || 0,
      removed: delta.counts?.removed || 0,
    },
  };

  return {
    index: indexPayload,
    indexText: `${JSON.stringify(indexPayload)}\n`,
    shardFiles,
    packageFiles,
    delta,
    deltaText: `${JSON.stringify(delta)}\n`,
  };
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function atomicWrite(file, content) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await writeFile(temp, content, 'utf8');
  await rename(temp, file);
}

async function writeMapConcurrently(entries, outDir, concurrency = 32) {
  const tasks = [...entries];
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const [relativePath, content] = tasks[cursor++];
      await atomicWrite(resolve(outDir, relativePath), content);
    }
  }
  const workers = Math.max(1, Math.min(Number(concurrency) || 32, tasks.length || 1));
  await Promise.all(Array.from({ length: workers }, worker));
}

export async function writeRegistryDistribution(registry, outDir, options = {}) {
  const distribution = buildRegistryDistribution(registry, options);
  const target = resolve(outDir);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });

  await writeMapConcurrently(
    [...distribution.shardFiles.entries()].map(([prefix, content]) => [`shards/${prefix}.json`, content]),
    target,
    options.concurrency,
  );
  await writeMapConcurrently(distribution.packageFiles.entries(), target, options.concurrency);
  await atomicWrite(resolve(target, 'delta.json'), distribution.deltaText);
  await atomicWrite(resolve(target, 'index.json'), distribution.indexText);

  return {
    out_dir: target,
    content_hash: distribution.index.content_hash,
    shards: distribution.index.shards.length,
    packages: distribution.index.package_count,
    records: distribution.index.count,
    delta_changed: distribution.delta.counts?.changed || 0,
    delta_removed: distribution.delta.counts?.removed || 0,
  };
}

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const registryFile = resolve(root, arg('--registry', 'catalog/registry-v3.json'));
  const outDir = resolve(root, arg('--out', 'site/public/catalog/distribution-v1'));
  const deltaFile = resolve(root, arg('--delta', 'catalog/distribution-delta.json'));
  const registry = JSON.parse(await readFile(registryFile, 'utf8'));
  const delta = await exists(deltaFile) ? JSON.parse(await readFile(deltaFile, 'utf8')) : null;
  const result = await writeRegistryDistribution(registry, outDir, { delta });
  console.log(`[registry-distribution] records=${result.records} packages=${result.packages} shards=${result.shards} hash=${result.content_hash} delta=${result.delta_changed}/${result.delta_removed}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error('[registry-distribution] failed:', error.stack || error.message);
    process.exit(1);
  });
}
