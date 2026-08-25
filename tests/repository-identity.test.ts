import { describe, expect, it } from 'vitest';

const {
  applyPluginOverride, canonicalRepoKey, canonicalRepoUrl, discoveryTopics, makeInstallCmd,
  mergeCatalogPluginsWithDiscovery, normalizePluginCategory, normalizeStoredPlugin,
} = await import('../scripts/repository-identity.mjs');
const { discoveryRepoToLegacy } = await import('../scripts/github-discovery.mjs');
const { applyManifestObservation } = await import('../scripts/sync.mjs');
const { auditCatalogIdentity } = await import('../scripts/audit-catalog-identity.mjs');

describe('repository identity', () => {
  it('normalizes GitHub identity independent of package metadata', () => {
    const plugin: any = normalizeStoredPlugin({
      full_name: 'ruvnet/ruflo', name: 'claude-flow', category: 'agent',
      manifest_file: 'package.json', verified: true, repo_url: 'https://api.github.com/repos/ruvnet/ruflo',
    });
    expect(plugin.name).toBe('ruflo');
    expect(plugin.repo_name).toBe('ruflo');
    expect(plugin.manifest_file).toBeNull();
    expect(plugin.verified).toBe(false);
    expect(plugin.repo_url).toBe('https://github.com/ruvnet/ruflo');
    expect(plugin.install_cmd).toContain('github:ruvnet/ruflo');
  });

  it('normalizes invalid retained categories instead of preserving arbitrary values', () => {
    expect(normalizePluginCategory('mcp')).toBe('mcp');
    expect(normalizePluginCategory('toString')).toBe('other');
    const plugin: any = normalizeStoredPlugin({ full_name: 'owner/demo', category: 'made-up' });
    expect(plugin.category).toBe('other');
  });

  it('uses stable repo ids to reconcile renames and removes stale identity', () => {
    const current: any = { full_name: 'owner/old-name', repo_id: '42', name: 'old-name', category: 'tool', topics: ['dsh-plugin'] };
    const live: any = { full_name: 'owner/new-name', repo_id: '42', name: 'new-name', repo_name: 'new-name', category: 'tool', topics: ['dsh-plugin'], tags: ['dsh-plugin'], stars: 1, repo_url: 'x' };
    const merged = mergeCatalogPluginsWithDiscovery([current], [live]);
    expect(merged.renamed).toBe(1);
    expect(merged.plugins).toHaveLength(1);
    expect(merged.plugins[0].full_name).toBe('owner/new-name');
    expect(merged.plugins[0].name).toBe('new-name');
  });

  it('prunes stale package-only history but keeps explicit manifests and overrides when observation is not required', () => {
    const existing: any[] = [
      { full_name: 'owner/package-only', name: 'package-name', category: 'tool', manifest_file: 'package.json', verified: true, topics: ['deepseek-harness'] },
      { full_name: 'owner/explicit', name: 'Explicit Brand', category: 'tool', manifest_file: 'dsh-plugin.json', verified: true, topics: ['deepseek-harness'] },
      { full_name: 'owner/manual', name: 'Manual Brand', category: 'tool', metadata_source: 'override', override_fields: ['name'], manifest_file: null, verified: false, topics: [] },
    ];
    const merged = mergeCatalogPluginsWithDiscovery(existing, []);
    expect(merged.pruned).toBe(1);
    expect(merged.plugins.map((p: any) => p.full_name).sort()).toEqual(['owner/explicit', 'owner/manual']);
  });

  it('drops explicit-manifest records not observed during the current full sync', () => {
    const existing: any[] = [
      { full_name: 'owner/stale', repo_id: '1', name: 'Stale', category: 'tool', manifest_file: 'dsh-plugin.json', verified: true },
      { full_name: 'owner/fresh', repo_id: '2', name: 'Fresh', category: 'tool', manifest_file: 'dsh-plugin.json', verified: true },
      { full_name: 'owner/fresh-by-id', repo_id: '3', name: 'Fresh by ID', category: 'tool', manifest_file: 'dsh-plugin.json', verified: true },
      { full_name: 'owner/manual', name: 'Manual', category: 'tool', metadata_source: 'override', override_fields: ['name'] },
    ];
    const merged = mergeCatalogPluginsWithDiscovery(existing, [], {
      requireObservation: true,
      observedRepos: ['OWNER/FRESH'],
      observedRepoIds: ['3'],
    });
    expect(merged.pruned).toBe(1);
    expect(merged.plugins.map((p: any) => p.full_name).sort()).toEqual(['owner/fresh', 'owner/fresh-by-id', 'owner/manual']);
  });

  it('does not let legacy record-wide override flags freeze polluted names', () => {
    const plugin: any = normalizeStoredPlugin({
      full_name: 'ruvnet/ruflo', name: 'claude-flow', category: 'agent', metadata_source: 'override',
    });
    expect(plugin.name).toBe('ruflo');
    expect(plugin.metadata_source).toBe('github');
    expect(plugin.override_fields).toBeUndefined();
  });

  it('preserves only explicitly overridden fields across repository renames', () => {
    const current: any = {
      full_name: 'owner/old-name', repo_id: '42', name: 'stale-package-name', category: 'agent',
      metadata_source: 'override', override_fields: ['category'], homepage: 'https://old.example/',
    };
    const live: any = {
      full_name: 'owner/new-name', repo_id: '42', name: 'new-name', repo_name: 'new-name', category: 'tool',
      description: 'live', topics: ['dsh-plugin'], tags: ['dsh-plugin'], homepage: 'https://new.example/', stars: 1,
    };
    const merged = mergeCatalogPluginsWithDiscovery([current], [live]).plugins[0] as any;
    expect(merged.name).toBe('new-name');
    expect(merged.category).toBe('agent');
    expect(merged.homepage).toBe('https://new.example/');
    expect(merged.override_fields).toEqual(['category']);
  });

  it('keeps explicit name aliases and sanitizes overridden homepage URLs', () => {
    const base: any = normalizeStoredPlugin({ full_name: 'owner/demo', name: 'demo', category: 'tool' });
    const aliased: any = applyPluginOverride(base, { name: 'Friendly Name', homepage: 'javascript:alert(1)' });
    expect(aliased.name).toBe('Friendly Name');
    expect(aliased.homepage).toBeNull();
    expect(aliased.metadata_source).toBe('override');
    expect(aliased.override_fields).toEqual(['homepage', 'name']);
  });

  it('deduplicates repository identity case-insensitively', () => {
    expect(canonicalRepoKey('Owner/Repo')).toBe(canonicalRepoKey('owner/repo'));
  });

  it('extracts GraphQL topics and true watcher/issue counts', () => {
    const repo: any = {
      databaseId: 7, name: 'demo', nameWithOwner: 'owner/demo', url: 'https://github.com/owner/demo',
      repositoryTopics: { nodes: [{ topic: { name: 'mcp' } }, { topic: { name: 'dsh-plugin' } }] },
      watchers: { totalCount: 9 }, issues: { totalCount: 3 }, stargazerCount: 100, forkCount: 5,
      defaultBranchRef: { name: 'main', target: { oid: '0123456789abcdef0123456789abcdef01234567' } },
    };
    expect(discoveryTopics(repo)).toEqual(['mcp', 'dsh-plugin']);
    const plugin: any = discoveryRepoToLegacy(repo);
    expect(plugin.category).toBe('mcp');
    expect(plugin.watchers).toBe(9);
    expect(plugin.open_issues).toBe(3);
    expect(plugin.repo_url).toBe('https://github.com/owner/demo');
    expect(plugin.repo_id).toBe('7');
  });

  it('upgrades and downgrades manifest authority only after an explicit observation', () => {
    const github: any = { full_name: 'owner/demo', repo_id: '7', name: 'demo', repo_name: 'demo', category: 'tool', topics: ['dsh-plugin'] };
    const observedManifest: any = applyManifestObservation(github, {
      observed: true,
      manifest: { file: 'dsh-plugin.json', data: { name: 'Branded Demo', category: 'mcp', tags: ['custom'] } },
    });
    const upgraded = mergeCatalogPluginsWithDiscovery([github], [observedManifest]).plugins[0] as any;
    expect(upgraded.name).toBe('Branded Demo');
    expect(upgraded.category).toBe('mcp');
    expect(upgraded.verified).toBe(true);
    expect(upgraded.manifest_file).toBe('dsh-plugin.json');

    const observedAbsent: any = applyManifestObservation(observedManifest, { observed: true, manifest: null });
    const downgraded = mergeCatalogPluginsWithDiscovery([upgraded], [observedAbsent]).plugins[0] as any;
    expect(downgraded.name).toBe('demo');
    expect(downgraded.verified).toBe(false);
    expect(downgraded.manifest_file).toBeNull();
  });

  it('preserves historical manifest authority when live manifest observation is uncertain', () => {
    const current: any = {
      full_name: 'owner/demo', repo_id: '7', name: 'Branded Demo', category: 'mcp', metadata_source: 'dsh-plugin',
      manifest_file: 'dsh-plugin.json', verified: true, tags: ['custom'],
    };
    const live: any = { full_name: 'owner/demo', repo_id: '7', name: 'demo', repo_name: 'demo', category: 'tool', topics: ['dsh-plugin'] };
    const uncertain: any = applyManifestObservation(live, { observed: false, manifest: null });
    const merged = mergeCatalogPluginsWithDiscovery([current], [uncertain]).plugins[0] as any;
    expect(merged.name).toBe('Branded Demo');
    expect(merged.verified).toBe(true);
    expect(merged.manifest_file).toBe('dsh-plugin.json');
  });

  it('audits wrong repo URLs and install sources', () => {
    const data: any = { plugins: [{ full_name: 'owner/demo', repo_name: 'demo', name: 'demo', metadata_source: 'github', category: 'tool', repo_url: 'https://api.github.com/repos/owner/demo', install_cmd: 'bad', manifest_file: null, verified: false }] };
    const result = auditCatalogIdentity(data);
    expect(result.errors.some((e: string) => e.includes('repo_url'))).toBe(true);
    expect(result.errors.some((e: string) => e.includes('install_cmd'))).toBe(true);
    expect(canonicalRepoUrl('owner/demo')).toBe('https://github.com/owner/demo');
    expect(makeInstallCmd('owner/demo', 'tool')).toContain('github:owner/demo');
  });
});
