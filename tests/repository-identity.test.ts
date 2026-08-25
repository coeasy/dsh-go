import { describe, expect, it } from 'vitest';

const {
  canonicalRepoKey, canonicalRepoUrl, discoveryTopics, makeInstallCmd,
  mergeCatalogPluginsWithDiscovery, normalizeStoredPlugin,
} = await import('../scripts/repository-identity.mjs');
const { discoveryRepoToLegacy } = await import('../scripts/github-discovery.mjs');
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

  it('uses stable repo ids to reconcile renames and removes stale identity', () => {
    const current: any = { full_name: 'owner/old-name', repo_id: '42', name: 'old-name', category: 'tool', topics: ['dsh-plugin'] };
    const live: any = { full_name: 'owner/new-name', repo_id: '42', name: 'new-name', repo_name: 'new-name', category: 'tool', topics: ['dsh-plugin'], tags: ['dsh-plugin'], stars: 1, repo_url: 'x' };
    const merged = mergeCatalogPluginsWithDiscovery([current], [live]);
    expect(merged.renamed).toBe(1);
    expect(merged.plugins).toHaveLength(1);
    expect(merged.plugins[0].full_name).toBe('owner/new-name');
    expect(merged.plugins[0].name).toBe('new-name');
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

  it('audits wrong repo URLs and install sources', () => {
    const data: any = { plugins: [{ full_name: 'owner/demo', repo_name: 'demo', name: 'demo', metadata_source: 'github', category: 'tool', repo_url: 'https://api.github.com/repos/owner/demo', install_cmd: 'bad', manifest_file: null, verified: false }] };
    const result = auditCatalogIdentity(data);
    expect(result.errors.some((e: string) => e.includes('repo_url'))).toBe(true);
    expect(result.errors.some((e: string) => e.includes('install_cmd'))).toBe(true);
    expect(canonicalRepoUrl('owner/demo')).toBe('https://github.com/owner/demo');
    expect(makeInstallCmd('owner/demo', 'tool')).toContain('github:owner/demo');
  });
});
