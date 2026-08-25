from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1))


replace_once(
    'scripts/sync.mjs',
    "export function dedupeTags(arr) {\n  const out = [];\n  const seen = new Set();\n  for (const raw of arr || []) {\n    if (!raw) continue;\n    const t = String(raw).trim().toLowerCase();\n    if (!t || seen.has(t)) continue;\n    seen.add(t);\n    out.push(t);\n  }\n  return out;\n}\n\nexport function detectCategory(repo, _manifest) {",
    "export function dedupeTags(arr) {\n  const out = [];\n  const seen = new Set();\n  for (const raw of arr || []) {\n    if (!raw) continue;\n    const t = String(raw).trim().toLowerCase();\n    if (!t || seen.has(t)) continue;\n    seen.add(t);\n    out.push(t);\n  }\n  return out;\n}\n\nexport function restRepositoryState(repo, previous = {}) {\n  const subscribers = repo?.subscribers_count;\n  const watchers = typeof subscribers === 'number' && Number.isFinite(subscribers)\n    ? subscribers\n    : Number(previous?.watchers || 0);\n  const deprecated = typeof repo?.archived === 'boolean' ? repo.archived : Boolean(previous?.deprecated);\n  const disabled = typeof repo?.disabled === 'boolean' ? repo.disabled : Boolean(previous?.disabled);\n  return { watchers, deprecated, disabled };\n}\n\nexport function detectCategory(repo, _manifest) {",
)
replace_once(
    'scripts/sync.mjs',
    "  const base = old ? old : {};\n  const now = new Date().toISOString();",
    "  const base = old ? old : {};\n  const repoState = restRepositoryState(repo, base);\n  const now = new Date().toISOString();",
)
replace_once(
    'scripts/sync.mjs',
    "    watchers: repo.subscribers_count || 0,\n    open_issues: repo.open_issues_count || 0,",
    "    watchers: repoState.watchers,\n    open_issues: repo.open_issues_count || 0,",
)
replace_once(
    'scripts/sync.mjs',
    "    homepage: repo.homepage || null,\n    verified: Boolean(manifest),",
    "    homepage: repo.homepage || null,\n    deprecated: repoState.deprecated,\n    disabled: repoState.disabled,\n    verified: Boolean(manifest),",
)

replace_once(
    'tests/sync.test.ts',
    "const { dedupeTags, computeTrendScore, detectCategory, isAuthoritativeManifestFile, normalizeCategory, sanitizeManifest } = await import('../scripts/sync.mjs');",
    "const { dedupeTags, computeTrendScore, detectCategory, isAuthoritativeManifestFile, normalizeCategory, restRepositoryState, sanitizeManifest } = await import('../scripts/sync.mjs');",
)
replace_once(
    'tests/sync.test.ts',
    "describe('dedupeTags', () => {",
    "describe('REST repository state', () => {\n  it('preserves true watcher counts when search results omit subscribers_count', () => {\n    expect(restRepositoryState({ archived: false, disabled: false }, { watchers: 443 })).toEqual({\n      watchers: 443, deprecated: false, disabled: false,\n    });\n    expect(restRepositoryState({ subscribers_count: 12, archived: true, disabled: true }, { watchers: 443 })).toEqual({\n      watchers: 12, deprecated: true, disabled: true,\n    });\n  });\n\n  it('preserves inactive state if a partial REST record omits lifecycle flags', () => {\n    expect(restRepositoryState({}, { watchers: 9, deprecated: true, disabled: true })).toEqual({\n      watchers: 9, deprecated: true, disabled: true,\n    });\n  });\n});\n\ndescribe('dedupeTags', () => {",
)
