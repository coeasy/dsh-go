import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildCatalogDistribution,
  buildLegacyPublicCatalog,
  DEFAULT_CATALOG_SHARD_BYTES,
  LEGACY_PUBLIC_MAX_BYTES,
  LEGACY_README_EXCERPT,
  PUBLIC_DESCRIPTION_LIMIT,
  PUBLIC_TAG_LIMIT,
  projectCatalogPlugin,
} from '../scripts/catalog-distribution.mjs';

const root = process.cwd();
const sourceCatalog = JSON.parse(readFileSync(resolve(root, 'catalog/plugins.json'), 'utf8'));

describe('public catalog distribution', () => {
  it('removes duplicated/runtime-only fields and caps unbounded display text', () => {
    const source = {
      slug: 'owner-repo',
      repo_id: '1',
      name: 'repo',
      full_name: 'owner/repo',
      description: 'd'.repeat(PUBLIC_DESCRIPTION_LIMIT + 500),
      category: 'mcp',
      topics: Array.from({ length: PUBLIC_TAG_LIMIT + 20 }, (_, index) => `topic-${index}`),
      tags: [],
      stars: 1,
      forks: 2,
      open_issues: 3,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-08-30T00:00:00Z',
      first_seen: '2026-01-01T00:00:00Z',
      trend_score: 4,
      language: 'TypeScript',
      license: 'MIT',
      install_cmd: 'duplicate derived command',
      repo_url: 'https://github.com/owner/repo',
      watchers: 99,
      rank: 123,
      manifest_file: 'dsh-mcp.json',
      capabilities: ['mcp'],
      dependencies: [{ id: 'x' }],
      permissions: ['network'],
      security: { score: 1 },
      snapshot_commit: 'a'.repeat(40),
      has_readme: true,
      readme_excerpt: 'r'.repeat(500),
    };

    const projected = projectCatalogPlugin(source) as Record<string, unknown>;
    expect(String(projected.description).length).toBe(PUBLIC_DESCRIPTION_LIMIT);
    expect((projected.tags as string[]).length).toBe(PUBLIC_TAG_LIMIT);
    expect(String(projected.readme_excerpt).length).toBe(LEGACY_README_EXCERPT);
    for (const field of ['topics', 'install_cmd', 'repo_url', 'watchers', 'rank', 'capabilities', 'dependencies', 'permissions', 'security', 'snapshot_commit']) {
      expect(projected).not.toHaveProperty(field);
    }
  });

  it('keeps the real compatibility export below the 24 MiB safety budget', () => {
    const legacy = buildLegacyPublicCatalog(sourceCatalog);
    expect(legacy.bytes).toBeLessThanOrEqual(LEGACY_PUBLIC_MAX_BYTES);
    expect(legacy.value.plugins.length).toBe(sourceCatalog.plugins.length);
    const first = legacy.value.plugins[0];
    expect(first.repo_url).toBe(`https://github.com/${first.full_name}`);
    expect(first.install_cmd).toContain(`github:${first.full_name}`);
    expect(first.topics).toEqual(first.tags);
  });

  it('partitions the real catalog by category and adaptively hash-splits only oversized categories', () => {
    const distribution = buildCatalogDistribution(sourceCatalog);
    expect(distribution.index.count).toBe(sourceCatalog.plugins.length);
    expect(distribution.index.shards.length).toBeGreaterThan(1);
    expect(distribution.index.shard_strategy).toMatchObject({
      category_partitioned: true,
      algorithm: 'sha256',
      adaptive_split: true,
    });
    expect(distribution.index.shards.every((shard) => shard.bytes <= DEFAULT_CATALOG_SHARD_BYTES)).toBe(true);
    expect(distribution.index.shards.reduce((total, shard) => total + shard.count, 0)).toBe(sourceCatalog.plugins.length);
    expect(new Set(distribution.index.shards.map((shard) => shard.path)).size).toBe(distribution.index.shards.length);
  });
});
