from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1))


# Metadata overrides never grant liveness: deleted/unobserved repositories must disappear.
replace_once(
    'scripts/repository-identity.mjs',
    "    const manifestAuthoritative = plugin.manifest_file === 'dsh-plugin.json';\n    const manualOverride = normalizeOverrideFields(plugin.override_fields).length > 0;\n    const repoId = plugin.repo_id ? String(plugin.repo_id) : '';",
    "    const manifestAuthoritative = plugin.manifest_file === 'dsh-plugin.json';\n    const repoId = plugin.repo_id ? String(plugin.repo_id) : '';",
)
replace_once(
    'scripts/repository-identity.mjs',
    "    if (!discovered && !manualOverride && (!manifestAuthoritative || !observedThisRun)) {",
    "    if (!discovered && (!manifestAuthoritative || !observedThisRun)) {",
)

replace_once(
    'tests/repository-identity.test.ts',
    "  it('prunes stale package-only history but keeps explicit manifests and overrides when observation is not required', () => {",
    "  it('prunes stale package-only and override-only history when repositories are no longer discoverable', () => {",
)
replace_once(
    'tests/repository-identity.test.ts',
    "    expect(merged.pruned).toBe(1);\n    expect(merged.plugins.map((p: any) => p.full_name).sort()).toEqual(['owner/explicit', 'owner/manual']);",
    "    expect(merged.pruned).toBe(2);\n    expect(merged.plugins.map((p: any) => p.full_name)).toEqual(['owner/explicit']);",
)
replace_once(
    'tests/repository-identity.test.ts',
    "    expect(merged.pruned).toBe(1);\n    expect(merged.plugins.map((p: any) => p.full_name).sort()).toEqual(['owner/fresh', 'owner/fresh-by-id', 'owner/manual']);",
    "    expect(merged.pruned).toBe(2);\n    expect(merged.plugins.map((p: any) => p.full_name).sort()).toEqual(['owner/fresh', 'owner/fresh-by-id']);",
)

# RSS is another public surface; inactive repositories must not leak there.
replace_once(
    'scripts/sync.mjs',
    "  const items = plugins\n    .filter((p) => (Date.now() - new Date(p.first_seen).getTime()) < 30 * 864e5)",
    "  const items = plugins\n    .filter((p) => !p.deprecated && !p.disabled && (Date.now() - new Date(p.first_seen).getTime()) < 30 * 864e5)",
)
replace_once(
    'tests/sync.test.ts',
    "const { dedupeTags, computeTrendScore, detectCategory, isAuthoritativeManifestFile, normalizeCategory, restRepositoryState, sanitizeManifest } = await import('../scripts/sync.mjs');",
    "const { buildFeed, dedupeTags, computeTrendScore, detectCategory, isAuthoritativeManifestFile, normalizeCategory, restRepositoryState, sanitizeManifest } = await import('../scripts/sync.mjs');",
)
replace_once(
    'tests/sync.test.ts',
    "describe('dedupeTags', () => {",
    "describe('public feed liveness', () => {\n  it('does not publish archived or disabled repositories', () => {\n    const firstSeen = new Date().toISOString();\n    const feed = buildFeed([\n      { name: 'active', full_name: 'owner/active', repo_url: 'https://github.com/owner/active', first_seen: firstSeen, updated_at: firstSeen },\n      { name: 'archived', full_name: 'owner/archived', repo_url: 'https://github.com/owner/archived', first_seen: firstSeen, updated_at: firstSeen, deprecated: true },\n      { name: 'disabled', full_name: 'owner/disabled', repo_url: 'https://github.com/owner/disabled', first_seen: firstSeen, updated_at: firstSeen, disabled: true },\n    ]);\n    expect(feed).toContain('owner/active');\n    expect(feed).not.toContain('owner/archived');\n    expect(feed).not.toContain('owner/disabled');\n  });\n});\n\ndescribe('dedupeTags', () => {",
)

# Slugs back file paths and deep links, so collisions must be case-insensitive too.
replace_once(
    'scripts/validate.mjs',
    "    if (!p.slug) errors.push(`存在缺少 slug 的插件: ${p.full_name || 'unknown'}`);\n    if (slugs.has(p.slug)) errors.push(`slug 重复: ${p.slug}`);\n    slugs.add(p.slug);",
    "    if (!p.slug) errors.push(`存在缺少 slug 的插件: ${p.full_name || 'unknown'}`);\n    const slugKey = String(p.slug || '').toLowerCase();\n    if (p.slug && !/^[A-Za-z0-9_.-]+$/.test(p.slug)) errors.push(`slug 非法: ${p.slug}`);\n    if (slugs.has(slugKey)) errors.push(`slug 大小写归一后重复: ${p.slug}`);\n    slugs.add(slugKey);",
)
replace_once(
    'tests/validate.test.ts',
    "    expect(validateCatalog(c).errors.some((e) => e.includes('slug 重复'))).toBe(true);",
    "    expect(validateCatalog(c).errors.some((e) => e.includes('slug 大小写归一后重复'))).toBe(true);",
)
replace_once(
    'tests/validate.test.ts',
    "  it('full_name 非法', () => {",
    "  it('slug 大小写冲突也会被阻断', () => {\n    const c = goodCatalog();\n    c.plugins[1].slug = 'A-B';\n    expect(validateCatalog(c).errors.some((e) => e.includes('slug 大小写归一后重复'))).toBe(true);\n  });\n\n  it('slug 含路径字符会被阻断', () => {\n    const c = goodCatalog();\n    c.plugins[0].slug = '../a-b';\n    expect(validateCatalog(c).errors.some((e) => e.includes('slug 非法'))).toBe(true);\n  });\n\n  it('full_name 非法', () => {",
)
