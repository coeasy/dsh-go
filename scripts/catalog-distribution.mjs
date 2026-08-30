#!/usr/bin/env node
/** Public catalog distribution: compact compatibility export + stable bounded shards. */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './checksum.mjs';

export const CATALOG_DISTRIBUTION_FORMAT = 'dsh-catalog-distribution';
export const CATALOG_DISTRIBUTION_VERSION = 1;
export const DEFAULT_CATALOG_SHARD_BYTES = 2 * 1024 * 1024;
export const LEGACY_PUBLIC_MAX_BYTES = 24 * 1024 * 1024;
export const LEGACY_README_EXCERPT = 160;
export const PUBLIC_DESCRIPTION_LIMIT = 1000;
export const PUBLIC_TAG_LIMIT = 32;
export const INITIAL_HASH_PREFIX_CHARS = 1;
export const MAX_HASH_PREFIX_CHARS = 4;

const VALID_CATEGORY = /^[a-z0-9-]+$/;

function asString(value, fallback = '') {
  return value === null || value === undefined ? fallback : String(value);
}

function asStringArray(value, limit = PUBLIC_TAG_LIMIT) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === 'string').map((item) => item.trim().toLowerCase()).filter(Boolean))].slice(0, limit);
}

function categoryName(value) {
  const category = asString(value, 'other').toLowerCase();
  return VALID_CATEGORY.test(category) ? category : 'other';
}

function repoName(fullName) {
  const parts = asString(fullName).split('/');
  return parts.length === 2 ? parts[1] : '';
}

function installProfile(category) {
  if (category === 'web-ui') return 'web';
  if (category === 'desktop') return 'desktop';
  return 'tools';
}

function installCommand(fullName, category) {
  return `dsh plugin --profile ${installProfile(category)} add github:${fullName}`;
}

function metadataSource(plugin) {
  if (Array.isArray(plugin?.override_fields) && plugin.override_fields.length) return 'override';
  const manifest = asString(plugin?.manifest_file);
  if (/^dsh-(package|plugin|mcp|skill|agent)\.json$/.test(manifest)) return manifest.replace(/\.json$/, '');
  return asString(plugin?.metadata_source, 'github') || 'github';
}

/**
 * Compact public projection. Source catalog keeps full sync state; public shards keep
 * only discovery/API fields. Registry-only security/dependency/runtime fields are not
 * duplicated here because Registry V3 is their installation authority.
 */
export function projectCatalogPlugin(plugin, options = {}) {
  const fullName = asString(plugin?.full_name);
  const category = categoryName(plugin?.category);
  const tags = asStringArray(plugin?.tags?.length ? plugin.tags : plugin?.topics);
  const excerptLimit = Number.isFinite(options.excerptLimit) ? Math.max(0, Number(options.excerptLimit)) : LEGACY_README_EXCERPT;
  const descriptionLimit = Number.isFinite(options.descriptionLimit) ? Math.max(0, Number(options.descriptionLimit)) : PUBLIC_DESCRIPTION_LIMIT;
  const description = descriptionLimit > 0 ? asString(plugin?.description).slice(0, descriptionLimit) : '';
  const projected = {
    slug: asString(plugin?.slug || fullName.replace('/', '-')),
    repo_id: plugin?.repo_id === null || plugin?.repo_id === undefined || plugin?.repo_id === '' ? undefined : asString(plugin.repo_id),
    name: asString(plugin?.name || repoName(fullName) || fullName).slice(0, 200),
    metadata_source: metadataSource(plugin),
    override_fields: Array.isArray(plugin?.override_fields) && plugin.override_fields.length ? asStringArray(plugin.override_fields, 16) : undefined,
    full_name: fullName,
    description,
    category,
    tags,
    stars: Number(plugin?.stars || 0),
    forks: Number(plugin?.forks || 0),
    open_issues: Number(plugin?.open_issues || 0),
    created_at: asString(plugin?.created_at),
    updated_at: asString(plugin?.updated_at),
    first_seen: asString(plugin?.first_seen),
    trend_score: Number(plugin?.trend_score || 0),
    language: asString(plugin?.language),
    license: asString(plugin?.license),
    homepage: plugin?.homepage ? asString(plugin.homepage) : null,
    verified: plugin?.verified === true,
    deprecated: plugin?.deprecated === true ? true : undefined,
    disabled: plugin?.disabled === true ? true : undefined,
    has_readme: plugin?.has_readme === true,
    readme_excerpt: excerptLimit > 0 && plugin?.readme_excerpt ? asString(plugin.readme_excerpt).slice(0, excerptLimit) : undefined,
  };
  return Object.fromEntries(Object.entries(projected).filter(([, value]) => value !== undefined));
}

export function hydrateCatalogPlugin(plugin) {
  const fullName = asString(plugin?.full_name);
  const category = categoryName(plugin?.category);
  const tags = asStringArray(plugin?.tags?.length ? plugin.tags : plugin?.topics);
  return {
    ...plugin,
    slug: asString(plugin?.slug || fullName.replace('/', '-')),
    name: asString(plugin?.name || repoName(fullName) || fullName),
    repo_name: asString(plugin?.repo_name || repoName(fullName)),
    full_name: fullName,
    description: asString(plugin?.description),
    category,
    topics: Array.isArray(plugin?.topics) ? asStringArray(plugin.topics) : tags,
    tags,
    stars: Number(plugin?.stars || 0),
    forks: Number(plugin?.forks || 0),
    open_issues: Number(plugin?.open_issues || 0),
    created_at: asString(plugin?.created_at),
    updated_at: asString(plugin?.updated_at),
    first_seen: asString(plugin?.first_seen),
    trend_score: Number(plugin?.trend_score || 0),
    language: asString(plugin?.language),
    license: asString(plugin?.license),
    install_cmd: asString(plugin?.install_cmd || installCommand(fullName, category)),
    repo_url: asString(plugin?.repo_url || (fullName ? `https://github.com/${fullName}` : '')),
    homepage: plugin?.homepage || null,
    verified: plugin?.verified === true,
    deprecated: plugin?.deprecated === true,
    disabled: plugin?.disabled === true,
    has_readme: plugin?.has_readme === true,
    readme_excerpt: asString(plugin?.readme_excerpt),
  };
}

/** Full-array compatibility file for legacy consumers, compacted and kept below 24 MiB. */
export function buildLegacyPublicCatalog(catalog, options = {}) {
  const maxBytes = Number(options.maxBytes || LEGACY_PUBLIC_MAX_BYTES);
  const strategies = options.strategies || [
    { excerptLimit: LEGACY_README_EXCERPT, descriptionLimit: PUBLIC_DESCRIPTION_LIMIT },
    { excerptLimit: 0, descriptionLimit: PUBLIC_DESCRIPTION_LIMIT },
    { excerptLimit: 0, descriptionLimit: 600 },
  ];
  for (const strategy of strategies) {
    const plugins = (catalog?.plugins || []).map((plugin) => hydrateCatalogPlugin(projectCatalogPlugin(plugin, strategy)));
    const value = {
      version: Number(catalog?.version || 2),
      meta: {
        ...(catalog?.meta || {}),
        distribution: {
          version: CATALOG_DISTRIBUTION_VERSION,
          index_path: 'catalog/catalog-v3/index.json',
          primary: true,
        },
      },
      plugins,
    };
    const text = `${JSON.stringify(value)}\n`;
    const bytes = Buffer.byteLength(text);
    if (bytes <= maxBytes) return { value, text, bytes, ...strategy };
  }
  throw new Error(`public catalog compatibility export exceeds ${maxBytes} bytes after compaction`);
}

function shardText(category, prefix, plugins) {
  return `${JSON.stringify({
    format: CATALOG_DISTRIBUTION_FORMAT,
    distribution_version: CATALOG_DISTRIBUTION_VERSION,
    category,
    hash_prefix: prefix,
    count: plugins.length,
    plugins,
  })}\n`;
}

function descriptorFor(category, prefix, entries) {
  const plugins = entries.map((entry) => entry.plugin).sort((a, b) => a.full_name.localeCompare(b.full_name));
  const text = shardText(category, prefix, plugins);
  const path = `shards/${category}-${prefix}.json`;
  return { path, category, hash_prefix: prefix, count: plugins.length, bytes: Buffer.byteLength(text), content_hash: sha256(text), text };
}

function splitBucket(category, entries, prefixChars, maxShardBytes, out) {
  const groups = new Map();
  for (const entry of entries) {
    const prefix = entry.hash.slice(0, prefixChars);
    const group = groups.get(prefix) || [];
    group.push(entry);
    groups.set(prefix, group);
  }
  for (const prefix of [...groups.keys()].sort()) {
    const group = groups.get(prefix) || [];
    const descriptor = descriptorFor(category, prefix, group);
    if (descriptor.bytes <= maxShardBytes) {
      out.push(descriptor);
      continue;
    }
    if (prefixChars >= MAX_HASH_PREFIX_CHARS) {
      if (group.length === 1) throw new Error(`single catalog record exceeds shard limit: ${group[0].plugin.full_name}`);
      throw new Error(`catalog shard ${category}-${prefix} is ${descriptor.bytes} bytes after maximum hash splitting`);
    }
    splitBucket(category, group, prefixChars + 1, maxShardBytes, out);
  }
}

/**
 * Category-first sharding. A category stays in one stable file while it fits; only an
 * oversized category expands into 16-way hash buckets, and only an oversized bucket expands
 * to the next nibble, so unrelated plugins retain stable shard URLs and CDN cache keys.
 */
export function buildCatalogDistribution(catalog, options = {}) {
  const maxShardBytes = Number(options.maxShardBytes || DEFAULT_CATALOG_SHARD_BYTES);
  if (!Number.isFinite(maxShardBytes) || maxShardBytes < 64 * 1024) throw new Error('maxShardBytes must be at least 65536');
  const projected = (catalog?.plugins || []).map((plugin) => projectCatalogPlugin(plugin));
  const grouped = new Map();
  for (const plugin of projected) {
    const category = categoryName(plugin.category);
    const list = grouped.get(category) || [];
    list.push({ plugin, hash: sha256(plugin.full_name || plugin.slug) });
    grouped.set(category, list);
  }

  const descriptors = [];
  const categoryCounts = {};
  for (const category of [...grouped.keys()].sort()) {
    const entries = grouped.get(category) || [];
    categoryCounts[category] = entries.length;
    const wholeCategory = descriptorFor(category, 'all', entries);
    if (wholeCategory.bytes <= maxShardBytes) descriptors.push(wholeCategory);
    else splitBucket(category, entries, INITIAL_HASH_PREFIX_CHARS, maxShardBytes, descriptors);
  }
  descriptors.sort((a, b) => a.path.localeCompare(b.path));
  const shardFiles = new Map(descriptors.map((descriptor) => [descriptor.path, descriptor.text]));
  const shards = descriptors.map(({ text: _text, ...descriptor }) => descriptor);

  const index = {
    format: CATALOG_DISTRIBUTION_FORMAT,
    distribution_version: CATALOG_DISTRIBUTION_VERSION,
    catalog_version: Number(catalog?.version || 2),
    generated_at: catalog?.meta?.updated_at || new Date().toISOString(),
    etag: asString(catalog?.meta?.etag),
    count: projected.length,
    max_shard_bytes: maxShardBytes,
    shard_strategy: {
      category_partitioned: true,
      algorithm: 'sha256',
      initial_prefix_chars: INITIAL_HASH_PREFIX_CHARS,
      max_prefix_chars: MAX_HASH_PREFIX_CHARS,
      adaptive_split: true,
    },
    meta: catalog?.meta || {},
    category_counts: categoryCounts,
    shards,
  };
  index.content_hash = sha256(JSON.stringify({ etag: index.etag, count: index.count, shards: shards.map(({ path, count, content_hash }) => ({ path, count, content_hash })) }));
  const indexText = `${JSON.stringify(index)}\n`;
  return { index, indexText, shardFiles };
}

export async function writeCatalogDistribution(catalog, outDir, options = {}) {
  const target = resolve(outDir);
  const distribution = buildCatalogDistribution(catalog, options);
  await rm(target, { recursive: true, force: true });
  await mkdir(resolve(target, 'shards'), { recursive: true });
  await Promise.all([...distribution.shardFiles.entries()].map(async ([relativePath, text]) => {
    const file = resolve(target, relativePath);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text, 'utf8');
  }));
  await writeFile(resolve(target, 'index.json'), distribution.indexText, 'utf8');
  return {
    out_dir: target,
    count: distribution.index.count,
    shards: distribution.index.shards.length,
    max_shard_bytes: distribution.index.max_shard_bytes,
    largest_shard_bytes: Math.max(0, ...distribution.index.shards.map((shard) => shard.bytes)),
    content_hash: distribution.index.content_hash,
  };
}

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const source = resolve(root, arg('--catalog', 'catalog/plugins.json'));
  const outDir = resolve(root, arg('--out', 'site/public/catalog/catalog-v3'));
  const legacyOut = resolve(root, arg('--legacy-out', 'site/public/catalog/plugins.json'));
  const catalog = JSON.parse(await readFile(source, 'utf8'));
  const result = await writeCatalogDistribution(catalog, outDir, { maxShardBytes: Number(process.env.CATALOG_SHARD_MAX_BYTES || DEFAULT_CATALOG_SHARD_BYTES) });
  const legacy = buildLegacyPublicCatalog(catalog);
  await mkdir(dirname(legacyOut), { recursive: true });
  await writeFile(legacyOut, legacy.text, 'utf8');
  console.log(`[catalog-distribution] records=${result.count} shards=${result.shards} largest=${result.largest_shard_bytes} hash=${result.content_hash} legacy_bytes=${legacy.bytes}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error('[catalog-distribution] failed:', error.stack || error.message);
    process.exit(1);
  });
}
