from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1))


# Deep-link fallback must copy the exact canonical install command, including profile.
replace_once(
    'site/src/pages/plugin/[slug].astro',
    '<button class="qbtn dsh" id="open-dsh" data-full={plugin.full_name} data-slug={plugin.slug} data-i18n="pl_open_dsh">用 DSH 打开</button>',
    '<button class="qbtn dsh" id="open-dsh" data-full={plugin.full_name} data-slug={plugin.slug} data-cmd={plugin.install_cmd} data-i18n="pl_open_dsh">用 DSH 打开</button>',
)
replace_once(
    'site/src/pages/plugin/[slug].astro',
    "        const cmd = `dsh plugin add github:${full}`;\n        if (navigator.clipboard) navigator.clipboard.writeText(cmd).catch(() => {});",
    "        const cmd = dsh.dataset.cmd || `dsh plugin add github:${full}`;\n        if (navigator.clipboard) navigator.clipboard.writeText(cmd).catch(() => {});",
)

# Registry ids are public/runtime identifiers; make collision rules match V2 slug rules.
replace_once(
    'scripts/registry-v3-builder.mjs',
    "    if (seenIds.has(normalized.id)) { excluded.push({ repo: normalized.repo, reason: `duplicate id: ${normalized.id}` }); continue; }\n    const repoKey = canonicalRepoKey(normalized.repo);",
    "    const idKey = normalized.id.toLowerCase();\n    if (seenIds.has(idKey)) { excluded.push({ repo: normalized.repo, reason: `duplicate id after case normalization: ${normalized.id}` }); continue; }\n    const repoKey = canonicalRepoKey(normalized.repo);",
)
replace_once(
    'scripts/registry-v3-builder.mjs',
    "    seenIds.add(normalized.id); seenRepos.add(repoKey); inputs.push({ legacy, normalized });",
    "    seenIds.add(idKey); seenRepos.add(repoKey); inputs.push({ legacy, normalized });",
)
replace_once(
    'scripts/validate-registry-v3.mjs',
    "    const id = String(plugin?.id || '');\n    if (!id) errors.push('plugin missing id');\n    if (ids.has(id)) errors.push(`duplicate id: ${id}`);\n    ids.add(id);",
    "    const id = String(plugin?.id || '');\n    const idKey = id.toLowerCase();\n    if (!id) errors.push('plugin missing id');\n    else if (!/^[A-Za-z0-9_.-]+$/.test(id)) errors.push(`invalid id: ${id}`);\n    if (ids.has(idKey)) errors.push(`duplicate id after case normalization: ${id}`);\n    ids.add(idKey);",
)

replace_once(
    'tests/registry-v3.test.ts',
    "  it('excludes archived or disabled repositories from the installable registry', async () => {",
    "  it('deduplicates registry ids case-insensitively during migration', async () => {\n    const commit = '0123456789abcdef0123456789abcdef01234567';\n    const catalog: any = {\n      meta: { etag: 'case-id', count: 2 },\n      plugins: [\n        { slug: 'Owner-Demo', full_name: 'owner/demo-one', name: 'demo-one', category: 'tool', snapshot_commit: commit, snapshot_ref: 'main' },\n        { slug: 'owner-demo', full_name: 'owner/demo-two', name: 'demo-two', category: 'tool', snapshot_commit: commit, snapshot_ref: 'main' },\n      ],\n    };\n    const { registry, stats } = await buildRegistryV3(catalog, null, { discoveryMode: 'complete', discoveredCount: 2 });\n    expect(registry.plugins).toHaveLength(1);\n    expect(stats.excluded.some((x: any) => x.reason.includes('duplicate id after case normalization'))).toBe(true);\n  });\n\n  it('validator rejects unsafe or case-colliding ids', () => {\n    const plugin: any = buildRegistryPlugin(legacy, { id: 'owner-demo', repo: 'owner/demo', ref: 'main' }, commit);\n    const duplicate: any = buildRegistryPlugin({ ...legacy, full_name: 'owner/demo-two' }, { id: 'OWNER-DEMO', repo: 'owner/demo-two', ref: 'main' }, commit);\n    const registry: any = {\n      registry_version: 3, schema_version: '3.0.0', defaults: { plugin_version: '0.1.0' },\n      generated: { at: new Date().toISOString(), source_catalog_etag: 'abc', source_catalog_count: 2, count: 2, excluded_count: 0, discovery_mode: 'complete', discovered_count: 2, content_hash: '' },\n      plugins: [plugin, duplicate],\n    };\n    registry.generated.content_hash = registryContentHash(registry);\n    expect(validateRegistry(registry).errors.some((e: string) => e.includes('duplicate id after case normalization'))).toBe(true);\n    registry.plugins[1].id = '../bad';\n    registry.generated.content_hash = registryContentHash(registry);\n    expect(validateRegistry(registry).errors.some((e: string) => e.includes('invalid id'))).toBe(true);\n  });\n\n  it('excludes archived or disabled repositories from the installable registry', async () => {",
)
