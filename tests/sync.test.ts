import { describe, it, expect } from 'vitest';
import { isAuthoritativeDshManifest } from '../scripts/repository-identity.mjs';

const { buildFeed, dedupeTags, computeTrendScore, detectCategory, normalizeCategory, restRepositoryState, sanitizeManifest } = await import('../scripts/discovery-sync.mjs');

describe('manifest authority', () => {
  it('only dsh-package.json can become install authority; legacy ecosystem files are discovery signals only', () => {
    expect(isAuthoritativeDshManifest('dsh-package.json')).toBe(true);
    expect(isAuthoritativeDshManifest('dsh-plugin.json')).toBe(false);
    expect(isAuthoritativeDshManifest('dsh-mcp.json')).toBe(false);
    expect(isAuthoritativeDshManifest('dsh-skill.json')).toBe(false);
    expect(isAuthoritativeDshManifest('dsh-agent.json')).toBe(false);
    expect(isAuthoritativeDshManifest('package.json')).toBe(false);
  });

  it('sanitizes discovery metadata without granting installation authority', () => {
    expect(normalizeCategory('mcp', 'other')).toBe('mcp');
    expect(normalizeCategory('toString', 'other')).toBe('other');
    expect(sanitizeManifest({ name: ' Brand ', description: ' demo ', category: 'not-real', tags: 'bad' })).toEqual({ name: 'Brand', description: 'demo', tags: [] });
    expect(sanitizeManifest({ name: 'Demo', category: 'skills', tags: [' AI ', 3, '', 'mcp'] })).toEqual({ name: 'Demo', category: 'skills', tags: ['AI', 'mcp'] });
  });
});

describe('category detection', () => {
  it('uses token matching instead of substring matches', () => {
    expect(detectCategory({ topics: [], description: 'MCP server bridge', name: 'Bridge' }, null)).toBe('mcp');
    expect(detectCategory({ topics: [], description: 'Webhook integration bridge', name: 'Bridge' }, null)).toBe('integration');
    expect(detectCategory({ topics: [], description: 'A codebook formatter', name: 'Codebook' }, null)).toBe('other');
    expect(detectCategory({ topics: ['web-ui'], description: '', name: 'Anything' }, null)).toBe('web-ui');
  });
});

describe('REST repository state', () => {
  it('preserves true watcher counts when search results omit subscribers_count', () => {
    expect(restRepositoryState({ archived: false, disabled: false }, { watchers: 443 })).toEqual({ watchers: 443, deprecated: false, disabled: false });
    expect(restRepositoryState({ subscribers_count: 12, archived: true, disabled: true }, { watchers: 443 })).toEqual({ watchers: 12, deprecated: true, disabled: true });
  });

  it('preserves inactive state if a partial REST record omits lifecycle flags', () => {
    expect(restRepositoryState({}, { watchers: 9, deprecated: true, disabled: true })).toEqual({ watchers: 9, deprecated: true, disabled: true });
  });
});

describe('public feed liveness', () => {
  it('does not publish archived or disabled repositories', () => {
    const firstSeen = new Date().toISOString();
    const feed = buildFeed([
      { name: 'active', full_name: 'owner/active', repo_url: 'https://github.com/owner/active', first_seen: firstSeen, updated_at: firstSeen },
      { name: 'archived', full_name: 'owner/archived', repo_url: 'https://github.com/owner/archived', first_seen: firstSeen, updated_at: firstSeen, deprecated: true },
      { name: 'disabled', full_name: 'owner/disabled', repo_url: 'https://github.com/owner/disabled', first_seen: firstSeen, updated_at: firstSeen, disabled: true },
    ]);
    expect(feed).toContain('owner/active');
    expect(feed).not.toContain('owner/archived');
    expect(feed).not.toContain('owner/disabled');
  });
});

describe('dedupeTags', () => {
  it('deduplicates, trims and lowercases tags', () => {
    expect(dedupeTags(['AI', 'ai', '', null, ' Agent ', undefined, 'agent'])).toEqual(['ai', 'agent']);
  });
  it('merges manifest tags and topics safely', () => {
    expect(dedupeTags(['vision', 'AI', 'vision', 'ocr'])).toEqual(['vision', 'ai', 'ocr']);
  });
});

describe('computeTrendScore', () => {
  const now = Date.now();
  const day = 864e5;
  const recent = new Date(now - 2 * day).toISOString();
  const oldUpd = new Date(now - 30 * day).toISOString();
  const freshCreated = new Date(now - 5 * day).toISOString();

  it('weights recently updated records higher', () => {
    const a = computeTrendScore({ stars: 10, updated_at: recent, created_at: oldUpd } as any);
    const b = computeTrendScore({ stars: 10, updated_at: oldUpd, created_at: oldUpd } as any);
    expect(a - b).toBe(20);
  });

  it('adds the recent-creation bonus independently', () => {
    const c = computeTrendScore({ stars: 5, updated_at: recent, created_at: freshCreated } as any);
    const d = computeTrendScore({ stars: 5, updated_at: oldUpd, created_at: oldUpd } as any);
    expect(c - d).toBe(30);
  });
});
