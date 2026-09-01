import { describe, expect, it } from 'vitest';

const { artifactIntegrity, registryContentHash } = await import('../scripts/checksum.mjs');
const { buildRegistryPlugin, buildRegistryV3, inferCapabilities, inferRuntimeType } = await import('../scripts/registry-v3-builder.mjs');
const { validateRegistry } = await import('../scripts/validate-registry-v3.mjs');
const { parsePluginSpec, resolvePlugin } = await import('../runtime/resolver.mjs');
const { verifyResolvedPlugin } = await import('../runtime/verifier.mjs');

describe('Registry V3', () => {
  const legacy = {
    slug: 'owner-demo', full_name: 'owner/demo', name: 'demo', description: 'x', category: 'mcp',
    updated_at: '2026-08-25T00:00:00Z', verified: true, manifest_file: 'dsh-plugin.json', stars: 10, rank: 1,
  };
  const commit = '0123456789abcdef0123456789abcdef01234567';

  it('pins every record to 0.1.0 and immutable commit', () => {
    const plugin = buildRegistryPlugin(legacy, { id: 'owner-demo', repo: 'owner/demo', ref: 'main' }, commit);
    expect(plugin.version).toBe('0.1.0');
    expect(plugin.source.commit).toBe(commit);
    expect(plugin.runtime.type).toBe('mcp');
    expect(plugin.capabilities).toContain('mcp');
    expect(plugin.artifact.integrity).toBe(artifactIntegrity(plugin));
  });

  it('publishes a DSH install command for manifest-backed packages', () => {
    const plugin = buildRegistryPlugin({
      ...legacy,
      id: 'dsh-go-marketplace', package_id: 'dsh-go-marketplace', package_type: 'mcp', package_version: '0.1.0',
      manifest_file: 'dsh-package.json', verified: true, category: 'mcp',
    } as any, { id: 'dsh-go-marketplace', repo: 'coeasy/dsh-go', ref: 'main' }, commit);
    expect(plugin.metadata.install_cmd).toBe('dsh mcp install dsh-go-marketplace@0.1.0');
  });

  it('infers runtime/capabilities deterministically', () => {
    expect(inferRuntimeType({ category: 'skills' })).toBe('skill');
    expect(inferCapabilities({ category: 'agent' })).toEqual(['agent', 'plugin']);
  });

  it('validates canonical registry hash and source identity', () => {
    const plugin = buildRegistryPlugin(legacy, { id: 'owner-demo', repo: 'owner/demo', ref: 'main' }, commit);
    const registry: any = {
      registry_version: 3,
      schema_version: '3.0.0',
      defaults: { plugin_version: '0.1.0' },
      generated: { at: new Date().toISOString(), source_catalog_etag: 'abc', source_catalog_count: 1, count: 1, excluded_count: 0, discovery_mode: 'complete', discovered_count: 1, content_hash: '' },
      plugins: [plugin],
    };
    registry.generated.content_hash = registryContentHash(registry);
    expect(validateRegistry(registry).errors).toEqual([]);
    registry.plugins[0].source.commit = 'bad';
    expect(validateRegistry(registry).errors.some((e: string) => e.includes('source.commit'))).toBe(true);
  });

  it('reuses immutable commit but refreshes renamed repository metadata', async () => {
    const oldLegacy: any = {
      slug: 'owner-stable-id', full_name: 'owner/old-name', repo_id: '42', repo_name: 'old-name', name: 'old-name',
      category: 'tool', updated_at: '2026-08-25T00:00:00Z', snapshot_ref: 'main', verified: false,
      manifest_file: null, metadata_source: 'github', stars: 1, rank: 2,
    };
    const previous: any = buildRegistryPlugin(oldLegacy, { id: 'owner-stable-id', repo: 'owner/old-name', ref: 'main' }, commit);
    const existing: any = {
      registry_version: 3,
      schema_version: '3.0.0',
      defaults: { plugin_version: '0.1.0' },
      generated: { discovery_mode: 'complete', discovered_count: 1 },
      plugins: [previous],
    };
    const renamed: any = {
      ...oldLegacy,
      full_name: 'owner/new-name', repo_name: 'new-name', name: 'new-name',
      repo_url: 'https://github.com/owner/new-name', install_cmd: 'dsh plugin --profile tools add github:owner/new-name',
    };
    const { registry, stats }: any = await buildRegistryV3(
      { meta: { etag: 'abc', count: 1 }, plugins: [renamed] },
      existing,
      { discoveryMode: 'complete', discoveredCount: 1 },
    );
    expect(stats.reused).toBe(1);
    expect(registry.plugins).toHaveLength(1);
    expect(registry.plugins[0].id).toBe('owner-stable-id');
    expect(registry.plugins[0].source.repo).toBe('owner/new-name');
    expect(registry.plugins[0].source.commit).toBe(commit);
    expect(registry.plugins[0].source.archive_url).toContain('/owner/new-name/');
    expect(registry.plugins[0].metadata.repo_name).toBe('new-name');
    expect(registry.plugins[0].metadata.repo_url).toBe('https://github.com/owner/new-name');
    expect(registry.plugins[0].artifact.integrity).toBe(artifactIntegrity(registry.plugins[0]));
  });

  it('self-heals polluted legacy identity during standalone Registry V3 migration', async () => {
    const commit = '0123456789abcdef0123456789abcdef01234567';
    const catalog: any = {
      meta: { etag: 'legacy', count: 1 },
      plugins: [{
        slug: 'ruvnet-ruflo', full_name: 'ruvnet/ruflo', name: 'claude-flow', category: 'skills',
        metadata_source: 'override', verified: true, manifest_file: 'package.json',
        repo_url: 'https://api.github.com/repos/ruvnet/ruflo', install_cmd: 'dsh plugin add github:ruvnet/claude-flow',
        snapshot_commit: commit, snapshot_ref: 'main',
      }],
    };
    const { registry } = await buildRegistryV3(catalog, null, { discoveryMode: 'complete', discoveredCount: 1 });
    const plugin: any = registry.plugins[0];
    expect(plugin.source.repo).toBe('ruvnet/ruflo');
    expect(plugin.metadata.name).toBe('ruflo');
    expect(plugin.metadata.repo_name).toBe('ruflo');
    expect(plugin.metadata.repo_url).toBe('https://github.com/ruvnet/ruflo');
    expect(plugin.metadata.install_cmd).toContain('github:ruvnet/ruflo');
    expect(plugin.metadata.metadata_source).toBe('github');
    expect(plugin.metadata.verified).toBe(false);
    expect(plugin.metadata.manifest_file).toBeNull();
    expect(validateRegistry(registry).errors).toEqual([]);
  });

  it('deduplicates registry ids case-insensitively during migration', async () => {
    const commit = '0123456789abcdef0123456789abcdef01234567';
    const catalog: any = {
      meta: { etag: 'case-id', count: 2 },
      plugins: [
        { slug: 'Owner-Demo', full_name: 'owner/demo-one', name: 'demo-one', category: 'tool', snapshot_commit: commit, snapshot_ref: 'main' },
        { slug: 'owner-demo', full_name: 'owner/demo-two', name: 'demo-two', category: 'tool', snapshot_commit: commit, snapshot_ref: 'main' },
      ],
    };
    const { registry, stats } = await buildRegistryV3(catalog, null, { discoveryMode: 'complete', discoveredCount: 2 });
    expect(registry.plugins).toHaveLength(1);
    expect(stats.excluded.some((x: any) => x.reason.includes('duplicate id after case normalization'))).toBe(true);
  });

  it('lets current catalog identity supersede a stale preserved Registry id case-insensitively', async () => {
    const current: any = {
      slug: 'stable-id', full_name: 'owner/current-repo', name: 'current-repo', category: 'tool',
      snapshot_commit: commit, snapshot_ref: 'main', updated_at: '2026-08-26T00:00:00Z',
    };
    const staleLegacy: any = {
      slug: 'STALE-ID', full_name: 'owner/stale-repo', name: 'stale-repo', category: 'tool',
      updated_at: '2026-08-24T00:00:00Z',
    };
    const stale: any = buildRegistryPlugin(staleLegacy, { id: 'STABLE-ID', repo: 'owner/stale-repo', ref: 'main' }, commit);
    const existing: any = {
      registry_version: 3,
      schema_version: '3.0.0',
      defaults: { plugin_version: '0.1.0' },
      generated: { discovery_mode: 'complete', discovered_count: 1 },
      plugins: [stale],
    };

    const { registry, stats }: any = await buildRegistryV3(
      { meta: { etag: 'incremental', count: 1 }, plugins: [current] },
      existing,
      { preserveExisting: true, discoveryMode: 'complete', discoveredCount: 1 },
    );

    expect(registry.plugins).toHaveLength(1);
    expect(registry.plugins[0].id).toBe('stable-id');
    expect(registry.plugins[0].source.repo).toBe('owner/current-repo');
    expect(stats.reused_existing_only).toBe(0);
    expect(stats.excluded).toEqual(expect.arrayContaining([
      expect.objectContaining({
        repo: 'owner/stale-repo',
        reason: 'preserved registry id superseded by current catalog: STABLE-ID',
      }),
    ]));
    expect(validateRegistry(registry).errors).toEqual([]);
  });

  it('validator rejects unsafe or case-colliding ids', () => {
    const plugin: any = buildRegistryPlugin(legacy, { id: 'owner-demo', repo: 'owner/demo', ref: 'main' }, commit);
    const duplicate: any = buildRegistryPlugin({ ...legacy, full_name: 'owner/demo-two' }, { id: 'OWNER-DEMO', repo: 'owner/demo-two', ref: 'main' }, commit);
    const registry: any = {
      registry_version: 3, schema_version: '3.0.0', defaults: { plugin_version: '0.1.0' },
      generated: { at: new Date().toISOString(), source_catalog_etag: 'abc', source_catalog_count: 2, count: 2, excluded_count: 0, discovery_mode: 'complete', discovered_count: 2, content_hash: '' },
      plugins: [plugin, duplicate],
    };
    registry.generated.content_hash = registryContentHash(registry);
    expect(validateRegistry(registry).errors.some((e: string) => e.includes('duplicate id after case normalization'))).toBe(true);
    registry.plugins[1].id = '../bad';
    registry.generated.content_hash = registryContentHash(registry);
    expect(validateRegistry(registry).errors.some((e: string) => e.includes('invalid id'))).toBe(true);
  });

  it('excludes archived or disabled repositories from the installable registry', async () => {
    const commit = '0123456789abcdef0123456789abcdef01234567';
    const catalog: any = {
      meta: { etag: 'abc', count: 3 },
      plugins: [
        { slug: 'owner-active', full_name: 'owner/active', name: 'active', category: 'tool', snapshot_commit: commit, snapshot_ref: 'main' },
        { slug: 'owner-archived', full_name: 'owner/archived', name: 'archived', category: 'tool', snapshot_commit: commit, snapshot_ref: 'main', deprecated: true },
        { slug: 'owner-disabled', full_name: 'owner/disabled', name: 'disabled', category: 'tool', snapshot_commit: commit, snapshot_ref: 'main', disabled: true },
      ],
    };
    const { registry, stats } = await buildRegistryV3(catalog, null, { discoveryMode: 'complete', discoveredCount: 3 });
    expect(registry.plugins.map((p: any) => p.source.repo)).toEqual(['owner/active']);
    expect(stats.excluded.some((x: any) => x.reason.includes('archived'))).toBe(true);
    expect(stats.excluded.some((x: any) => x.reason.includes('disabled'))).toBe(true);
  });
});

describe('Runtime resolver', () => {
  it('parses and resolves exact version only', () => {
    expect(parsePluginSpec('owner-demo')).toEqual({ id: 'owner-demo', version: '0.1.0' });
    expect(parsePluginSpec('owner-demo@0.1.0')).toEqual({ id: 'owner-demo', version: '0.1.0' });
    const commit = '0123456789abcdef0123456789abcdef01234567';
    const plugin: any = buildRegistryPlugin(
      { slug: 'owner-demo', full_name: 'owner/demo', category: 'tool', updated_at: '', name: 'demo' },
      { id: 'owner-demo', repo: 'owner/demo', ref: 'main' }, commit
    );
    const registry = { registry_version: 3, defaults: { plugin_version: '0.1.0' }, plugins: [plugin] };
    const resolved = resolvePlugin(registry, 'owner-demo');
    expect(resolved.commit).toBe(commit);
    expect(verifyResolvedPlugin(resolved).ok).toBe(true);
  });
});
