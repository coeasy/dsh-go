import { describe, expect, it } from 'vitest';
import { filterPlugins, parseQuery } from '../functions/_lib';

describe('catalog active/deprecated filtering', () => {
  const plugins: any[] = [
    { name: 'active', full_name: 'owner/active', description: '', category: 'tool', topics: [], tags: [], verified: false, language: '', license: '', created_at: '', updated_at: '', stars: 1, trend_score: 1 },
    { name: 'archived', full_name: 'owner/archived', description: '', category: 'tool', topics: [], tags: [], verified: false, language: '', license: '', created_at: '', updated_at: '', stars: 2, trend_score: 2, deprecated: true },
    { name: 'disabled', full_name: 'owner/disabled', description: '', category: 'tool', topics: [], tags: [], verified: false, language: '', license: '', created_at: '', updated_at: '', stars: 3, trend_score: 3, disabled: true },
  ];

  it('hides archived and disabled repositories by default', () => {
    expect(filterPlugins(plugins, {}).map((p: any) => p.name)).toEqual(['active']);
  });

  it('returns deprecated records only when explicitly requested', () => {
    const q = parseQuery(new URL('https://example.test/?include_deprecated=true'));
    expect(filterPlugins(plugins, q).map((p: any) => p.name)).toEqual(['disabled', 'archived', 'active']);
  });
});
