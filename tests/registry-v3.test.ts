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
