from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1))


replace_once(
    'scripts/repository-identity.mjs',
    "export function discoveryRepoId(repo) {\n  const id = repo?.databaseId ?? repo?.id ?? null;\n  if (id === null || id === undefined || id === '') return null;\n  return String(id);\n}\n\nexport function normalizeStoredPlugin(plugin) {",
    "export function discoveryRepoId(repo) {\n  const id = repo?.databaseId ?? repo?.id ?? null;\n  if (id === null || id === undefined || id === '') return null;\n  return String(id);\n}\n\nfunction pluginIdentityKey(plugin) {\n  const repoId = plugin?.repo_id ? String(plugin.repo_id) : '';\n  return repoId ? `id:${repoId}` : `repo:${canonicalRepoKey(plugin?.full_name)}`;\n}\n\nexport function findStoredPluginForRepository(existingPlugins, repo) {\n  const repoId = discoveryRepoId(repo);\n  const repoKey = canonicalRepoKey(repo?.full_name || repo?.nameWithOwner);\n  if (repoId) {\n    const byId = (existingPlugins || []).find((plugin) => String(plugin?.repo_id || '') === repoId);\n    if (byId) return byId;\n  }\n  const byPath = (existingPlugins || []).find((plugin) => canonicalRepoKey(plugin?.full_name) === repoKey) || null;\n  if (repoId && byPath?.repo_id && String(byPath.repo_id) !== repoId) return null;\n  return byPath;\n}\n\nexport function ensureUniquePluginSlugs(plugins, reservedPlugins = []) {\n  const claimed = new Map();\n  // Historical repo_id -> slug ownership wins over discovery order. This preserves a\n  // renamed repository's stable id when a new repository later reuses its old path.\n  for (const raw of reservedPlugins || []) {\n    const slug = String(raw?.slug || '').trim();\n    if (!slug) continue;\n    const key = slug.toLowerCase();\n    if (!claimed.has(key)) claimed.set(key, pluginIdentityKey(raw));\n  }\n  return (plugins || []).map((raw) => {\n    const plugin = { ...raw };\n    const identity = pluginIdentityKey(plugin);\n    const fallback = String(plugin.full_name || '').replace('/', '-');\n    const base = String(plugin.slug || fallback || 'plugin').trim();\n    let candidate = base;\n    let sequence = 2;\n    while (true) {\n      const key = candidate.toLowerCase();\n      const owner = claimed.get(key);\n      if (!owner || owner === identity) {\n        claimed.set(key, identity);\n        plugin.slug = candidate;\n        return plugin;\n      }\n      candidate = plugin.repo_id ? `${base}-${plugin.repo_id}` : `${base}-${sequence++}`;\n    }\n  });\n}\n\nexport function normalizeStoredPlugin(plugin) {",
)

replace_once(
    'scripts/repository-identity.mjs',
    "  const byKey = new Map();\n  const idToKey = new Map();\n  const observationRequired = Boolean(options.requireObservation);",
    "  const byKey = new Map();\n  const existingById = new Map();\n  const observationRequired = Boolean(options.requireObservation);",
)
replace_once(
    'scripts/repository-identity.mjs',
    "    byKey.set(key, plugin);\n    if (plugin.repo_id) idToKey.set(String(plugin.repo_id), key);",
    "    byKey.set(key, plugin);\n    if (plugin.repo_id) existingById.set(String(plugin.repo_id), plugin);",
)
replace_once(
    'scripts/repository-identity.mjs',
    "    const id = live.repo_id ? String(live.repo_id) : '';\n    const matchedKey = (id && idToKey.get(id)) || (byKey.has(liveKey) ? liveKey : '');\n    const current = matchedKey ? byKey.get(matchedKey) : null;\n    if (matchedKey && matchedKey !== liveKey) {\n      byKey.delete(matchedKey);\n      renamed++;\n    }\n    const merged = mergeDiscoveredRepository(current, live);\n    byKey.set(liveKey, merged);\n    if (id) idToKey.set(id, liveKey);",
    "    const id = live.repo_id ? String(live.repo_id) : '';\n    const idCurrent = id ? existingById.get(id) : null;\n    const pathCurrent = byKey.get(liveKey) || null;\n    const pathIdentityCompatible = !id || !pathCurrent?.repo_id || String(pathCurrent.repo_id) === id;\n    const current = idCurrent || (pathIdentityCompatible ? pathCurrent : null);\n    const matchedKey = current ? canonicalRepoKey(current.full_name) : '';\n    if (matchedKey && matchedKey !== liveKey) {\n      const occupant = byKey.get(matchedKey);\n      if (occupant && pluginIdentityKey(occupant) === pluginIdentityKey(current)) byKey.delete(matchedKey);\n      renamed++;\n    }\n    // Same owner/repo path with a different stable GitHub repository id is a replacement,\n    // not a continuation. Do not inherit historical manifest/override metadata from it.\n    const merged = mergeDiscoveredRepository(current, live);\n    byKey.set(liveKey, merged);",
)
replace_once(
    'scripts/repository-identity.mjs',
    "  return { plugins, renamed, pruned };",
    "  return { plugins: ensureUniquePluginSlugs(plugins, existingPlugins), renamed, pruned };",
)

replace_once(
    'scripts/sync.mjs',
    "import { applyPluginOverride, canonicalRepoKey, canonicalRepoUrl, discoveryRepoId, makeInstallCmd, normalizeStoredPlugin } from './repository-identity.mjs';",
    "import { applyPluginOverride, canonicalRepoKey, canonicalRepoUrl, discoveryRepoId, ensureUniquePluginSlugs, findStoredPluginForRepository, makeInstallCmd, normalizeStoredPlugin } from './repository-identity.mjs';",
)
replace_once(
    'scripts/sync.mjs',
    "  const repoId = discoveryRepoId(repo);\n  const repoKey = canonicalRepoKey(fullName);\n  const old = oldPlugins.find((p) => (repoId && String(p.repo_id || '') === repoId) || canonicalRepoKey(p.full_name) === repoKey);",
    "  const repoId = discoveryRepoId(repo);\n  const old = findStoredPluginForRepository(oldPlugins, repo);",
)
replace_once(
    'scripts/sync.mjs',
    "    slug: fullName.replace('/', '-'),",
    "    slug: base.slug || fullName.replace('/', '-'),",
)
replace_once(
    'scripts/sync.mjs',
    "  // 排序 + trend_score（verified 优先，其次 trend_score，符合方案 §3.1）\n  // 先重算 trend_score，再排序，最后赋 rank（保证 rank/API sort=trend 一致）\n  plugins.forEach((p) => { p.trend_score = computeTrendScore(p); });",
    "  // Preserve stable ids across renames while repairing the rare case where a new\n  // repository later reuses an old owner/name path and would otherwise collide on slug.\n  plugins = ensureUniquePluginSlugs(plugins, oldPlugins);\n\n  // 排序 + trend_score（verified 优先，其次 trend_score，符合方案 §3.1）\n  // 先重算 trend_score，再排序，最后赋 rank（保证 rank/API sort=trend 一致）\n  plugins.forEach((p) => { p.trend_score = computeTrendScore(p); });",
)

replace_once(
    'tests/repository-identity.test.ts',
    "  applyPluginOverride, canonicalRepoKey, canonicalRepoUrl, discoveryTopics, makeInstallCmd,\n  mergeCatalogPluginsWithDiscovery, normalizePluginCategory, normalizeStoredPlugin,",
    "  applyPluginOverride, canonicalRepoKey, canonicalRepoUrl, discoveryTopics, ensureUniquePluginSlugs, findStoredPluginForRepository, makeInstallCmd,\n  mergeCatalogPluginsWithDiscovery, normalizePluginCategory, normalizeStoredPlugin,",
)
replace_once(
    'tests/repository-identity.test.ts',
    "    const current: any = { full_name: 'owner/old-name', repo_id: '42', name: 'old-name', category: 'tool', topics: ['dsh-plugin'] };",
    "    const current: any = { slug: 'owner-old-name', full_name: 'owner/old-name', repo_id: '42', name: 'old-name', category: 'tool', topics: ['dsh-plugin'] };",
)
replace_once(
    'tests/repository-identity.test.ts',
    "    expect(merged.plugins[0].full_name).toBe('owner/new-name');\n    expect(merged.plugins[0].name).toBe('new-name');",
    "    expect(merged.plugins[0].full_name).toBe('owner/new-name');\n    expect(merged.plugins[0].name).toBe('new-name');\n    expect(merged.plugins[0].slug).toBe('owner-old-name');",
)
replace_once(
    'tests/repository-identity.test.ts',
    "  it('prunes stale package-only history but keeps explicit manifests and overrides when observation is not required', () => {",
    "  it('treats a reused owner/repo path with a different repo id as a new repository identity', () => {\n    const previous: any = {\n      slug: 'owner-demo', full_name: 'owner/demo', repo_id: '1', name: 'Old Brand', category: 'mcp',\n      metadata_source: 'dsh-plugin', manifest_file: 'dsh-plugin.json', verified: true, tags: ['old'],\n    };\n    const replacement: any = {\n      slug: 'owner-demo', full_name: 'owner/demo', repo_id: '2', repo_name: 'demo', name: 'demo', category: 'tool',\n      metadata_source: 'github', manifest_file: null, verified: false, topics: ['dsh-plugin'], tags: ['dsh-plugin'],\n    };\n    expect(findStoredPluginForRepository([previous], { id: 2, full_name: 'owner/demo' })).toBeNull();\n    const merged = mergeCatalogPluginsWithDiscovery([previous], [replacement]).plugins[0] as any;\n    expect(merged.repo_id).toBe('2');\n    expect(merged.name).toBe('demo');\n    expect(merged.verified).toBe(false);\n    expect(merged.manifest_file).toBeNull();\n  });\n\n  it('keeps stable renamed ids while giving a replacement repository a collision-free slug', () => {\n    const existing: any[] = [{\n      slug: 'owner-old', full_name: 'owner/old', repo_id: '1', name: 'old', category: 'tool', metadata_source: 'github',\n    }];\n    const replacement: any = { slug: 'owner-old', full_name: 'owner/old', repo_id: '2', repo_name: 'old', name: 'old', category: 'tool', metadata_source: 'github' };\n    const renamed: any = { slug: 'owner-new', full_name: 'owner/new', repo_id: '1', repo_name: 'new', name: 'new', category: 'tool', metadata_source: 'github' };\n    const merged = mergeCatalogPluginsWithDiscovery(existing, [replacement, renamed]).plugins as any[];\n    const oldIdentity = merged.find((p: any) => p.repo_id === '1');\n    const newIdentity = merged.find((p: any) => p.repo_id === '2');\n    expect(oldIdentity.slug).toBe('owner-old');\n    expect(newIdentity.slug).not.toBe('owner-old');\n    expect(new Set(merged.map((p: any) => p.slug)).size).toBe(2);\n    expect(ensureUniquePluginSlugs(merged, existing).map((p: any) => p.slug)).toEqual(merged.map((p: any) => p.slug));\n  });\n\n  it('prunes stale package-only history but keeps explicit manifests and overrides when observation is not required', () => {",
)
