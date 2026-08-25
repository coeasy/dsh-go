from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1))


replace_once(
    'scripts/registry-v3-builder.mjs',
    "import { canonicalRepoKey, canonicalRepoUrl, makeInstallCmd, repoNameFromFullName } from './repository-identity.mjs';",
    "import { canonicalRepoKey, canonicalRepoUrl, makeInstallCmd, normalizeStoredPlugin, repoNameFromFullName } from './repository-identity.mjs';",
)
replace_once(
    'scripts/registry-v3-builder.mjs',
    "  for (const legacy of legacyCatalog?.plugins || []) {\n    const normalized = normalizeLegacyPlugin(legacy);",
    "  for (const rawLegacy of legacyCatalog?.plugins || []) {\n    // Registry build/migration is also an identity boundary. Never assume the legacy\n    // catalog was produced by the latest sync code: canonicalize stale names, URLs,\n    // install commands, manifest authority and legacy record-wide override flags here.\n    const legacy = normalizeStoredPlugin(rawLegacy);\n    const normalized = normalizeLegacyPlugin(legacy);",
)

replace_once(
    'scripts/validate-registry-v3.mjs',
    "    if (metadata.repo_name && metadata.repo_name !== repoNameFromFullName(repo)) errors.push(`${id}: metadata.repo_name mismatch`);\n    if (metadata.repo_url && metadata.repo_url !== canonicalRepoUrl(repo)) errors.push(`${id}: metadata.repo_url is not canonical`);\n    if (metadata.install_cmd && metadata.install_cmd !== makeInstallCmd(repo, metadata.category || 'other')) errors.push(`${id}: metadata.install_cmd source mismatch`);\n    if (metadata.verified && metadata.manifest_file !== 'dsh-plugin.json') errors.push(`${id}: verified metadata requires dsh-plugin.json`);\n    if (metadata.manifest_file && metadata.manifest_file !== 'dsh-plugin.json') errors.push(`${id}: unsupported manifest_file ${metadata.manifest_file}`);\n    const overrideFields = normalizeOverrideFields(metadata.override_fields);\n    if (metadata.metadata_source === 'override' && overrideFields.length === 0) errors.push(`${id}: override metadata missing override_fields`);",
    "    const repoName = repoNameFromFullName(repo);\n    if (metadata.repo_name !== repoName) errors.push(`${id}: metadata.repo_name mismatch`);\n    if (metadata.repo_url !== canonicalRepoUrl(repo)) errors.push(`${id}: metadata.repo_url is not canonical`);\n    if (metadata.install_cmd !== makeInstallCmd(repo, metadata.category || 'other')) errors.push(`${id}: metadata.install_cmd source mismatch`);\n    if (!['github', 'dsh-plugin', 'override'].includes(metadata.metadata_source)) errors.push(`${id}: unsupported metadata_source ${metadata.metadata_source || '<missing>'}`);\n    if (metadata.metadata_source === 'github' && metadata.name !== repoName) errors.push(`${id}: GitHub metadata.name must match repository name`);\n    if (metadata.metadata_source === 'github' && (metadata.verified || metadata.manifest_file)) errors.push(`${id}: GitHub metadata cannot be verified or manifest-backed`);\n    if (metadata.metadata_source === 'dsh-plugin' && (!metadata.verified || metadata.manifest_file !== 'dsh-plugin.json')) errors.push(`${id}: dsh-plugin metadata requires verified dsh-plugin.json`);\n    if (metadata.verified && metadata.manifest_file !== 'dsh-plugin.json') errors.push(`${id}: verified metadata requires dsh-plugin.json`);\n    if (metadata.manifest_file && metadata.manifest_file !== 'dsh-plugin.json') errors.push(`${id}: unsupported manifest_file ${metadata.manifest_file}`);\n    const overrideFields = normalizeOverrideFields(metadata.override_fields);\n    if (metadata.metadata_source === 'override' && overrideFields.length === 0) errors.push(`${id}: override metadata missing override_fields`);",
)

replace_once(
    'tests/registry-v3.test.ts',
    "  it('excludes archived or disabled repositories from the installable registry', async () => {",
    "  it('self-heals polluted legacy identity during standalone Registry V3 migration', async () => {\n    const commit = '0123456789abcdef0123456789abcdef01234567';\n    const catalog: any = {\n      meta: { etag: 'legacy', count: 1 },\n      plugins: [{\n        slug: 'ruvnet-ruflo', full_name: 'ruvnet/ruflo', name: 'claude-flow', category: 'skills',\n        metadata_source: 'override', verified: true, manifest_file: 'package.json',\n        repo_url: 'https://api.github.com/repos/ruvnet/ruflo', install_cmd: 'dsh plugin add github:ruvnet/claude-flow',\n        snapshot_commit: commit, snapshot_ref: 'main',\n      }],\n    };\n    const { registry } = await buildRegistryV3(catalog, null, { discoveryMode: 'complete', discoveredCount: 1 });\n    const plugin: any = registry.plugins[0];\n    expect(plugin.source.repo).toBe('ruvnet/ruflo');\n    expect(plugin.metadata.name).toBe('ruflo');\n    expect(plugin.metadata.repo_name).toBe('ruflo');\n    expect(plugin.metadata.repo_url).toBe('https://github.com/ruvnet/ruflo');\n    expect(plugin.metadata.install_cmd).toContain('github:ruvnet/ruflo');\n    expect(plugin.metadata.metadata_source).toBe('github');\n    expect(plugin.metadata.verified).toBe(false);\n    expect(plugin.metadata.manifest_file).toBeNull();\n    expect(validateRegistry(registry).errors).toEqual([]);\n  });\n\n  it('excludes archived or disabled repositories from the installable registry', async () => {",
)
