from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1))


replace_once(
    'functions/_lib.ts',
    "  verified: boolean;\n  has_readme: boolean;",
    "  verified: boolean;\n  deprecated?: boolean;\n  disabled?: boolean;\n  has_readme: boolean;",
)
replace_once(
    'functions/_lib.ts',
    "export function filterPlugins(plugins: Plugin[], q: Query): Plugin[] {\n  let list = plugins;",
    "export function filterPlugins(plugins: Plugin[], q: Query): Plugin[] {\n  let list = plugins;\n  if (!q.include_deprecated) list = list.filter((p) => !p.deprecated && !p.disabled);",
)

replace_once(
    'site/src/pages/index.astro',
    "const { meta, plugins } = data;\n// 首屏按 stars 降序展示（高星在前、可进详情页；低星在后、卡片跳 GitHub），\n// 与客户端默认 sort=stars 保持一致\nconst sorted = [...(plugins as any[])].sort((a: any, b: any) => (b.stars || 0) - (a.stars || 0));\nconst topStars = sorted.slice(0, 3);\nconst verifiedRate = meta.stats?.total ? Math.round((Number(meta.stats.verified) / Number(meta.stats.total)) * 100) : 0;\nconst catCount = Object.keys(meta.stats?.by_category || {}).length;",
    "const { meta, plugins } = data;\nconst visiblePlugins = (plugins as any[]).filter((p: any) => !p.deprecated && !p.disabled);\n// 首屏按 stars 降序展示（高星在前、可进详情页；低星在后、卡片跳 GitHub），\n// 与 API 默认过滤 deprecated/disabled 后的 sort=stars 保持一致\nconst sorted = [...visiblePlugins].sort((a: any, b: any) => (b.stars || 0) - (a.stars || 0));\nconst topStars = sorted.slice(0, 3);\nconst verifiedRate = visiblePlugins.length ? Math.round((visiblePlugins.filter((p: any) => p.verified).length / visiblePlugins.length) * 100) : 0;\nconst catCount = new Set(visiblePlugins.map((p: any) => p.category).filter(Boolean)).size;",
)
replace_once(
    'site/src/pages/index.astro',
    "for (const p of plugins as any[]) { const l = p.language || 'Unknown'; langCounts[l] = (langCounts[l] || 0) + 1; }",
    "for (const p of visiblePlugins) { const l = p.language || 'Unknown'; langCounts[l] = (langCounts[l] || 0) + 1; }",
)
replace_once(
    'site/src/pages/index.astro',
    "    <p class=\"sub\" data-i18n=\"hero_sub\" data-count={meta.count || 0}>收录 {meta.count || 0} 个 dsh-plugin 插件，每日自动更新 · 全开源 · 开放 API</p>",
    "    <p class=\"sub\" data-i18n=\"hero_sub\" data-count={visiblePlugins.length}>收录 {visiblePlugins.length} 个活跃 dsh-plugin 插件，每日自动更新 · 全开源 · 开放 API</p>",
)
replace_once(
    'site/src/pages/index.astro',
    "      <span class=\"pill\"><b>{fmtK(meta.count || 0)}</b><i data-i18n=\"hero_daily\">每日同步</i></span>",
    "      <span class=\"pill\"><b>{fmtK(visiblePlugins.length)}</b><i data-i18n=\"hero_daily\">每日同步</i></span>",
)

replace_once(
    'site/src/pages/plugin/[slug].astro',
    "  const detailed = plugins.filter((p) => p.stars >= DETAIL_THRESHOLD);",
    "  const detailed = plugins.filter((p) => !p.deprecated && !p.disabled && p.stars >= DETAIL_THRESHOLD);",
)

replace_once(
    'scripts/copy-assets.mjs',
    "  const wanted = new Set((data.plugins || []).filter((plugin) => (plugin.stars || 0) >= DETAIL_THRESHOLD).flatMap((plugin) => [`${plugin.slug}.sh`, `${plugin.slug}.ps1`]));",
    "  const wanted = new Set((data.plugins || []).filter((plugin) => !plugin.deprecated && !plugin.disabled && (plugin.stars || 0) >= DETAIL_THRESHOLD).flatMap((plugin) => [`${plugin.slug}.sh`, `${plugin.slug}.ps1`]));",
)
replace_once(
    'scripts/copy-assets.mjs',
    "    if ((plugin.stars || 0) < DETAIL_THRESHOLD) continue;",
    "    if (plugin.deprecated || plugin.disabled || (plugin.stars || 0) < DETAIL_THRESHOLD) continue;",
)

replace_once(
    'scripts/registry-v3-builder.mjs',
    "    const normalized = normalizeLegacyPlugin(legacy);\n    if (normalized.error) { excluded.push({ repo: legacy?.full_name || '', reason: normalized.error }); continue; }",
    "    const normalized = normalizeLegacyPlugin(legacy);\n    if (normalized.error) { excluded.push({ repo: legacy?.full_name || '', reason: normalized.error }); continue; }\n    if (legacy?.disabled) { excluded.push({ repo: normalized.repo, reason: 'repository disabled' }); continue; }\n    if (legacy?.deprecated) { excluded.push({ repo: normalized.repo, reason: 'repository archived/deprecated' }); continue; }",
)

replace_once(
    'scripts/validate.mjs',
    "import { canonicalRepoKey, canonicalRepoUrl, makeInstallCmd, repoNameFromFullName } from './repository-identity.mjs';",
    "import { canonicalRepoKey, canonicalRepoUrl, isValidRepositoryName, makeInstallCmd, normalizeHttpUrl, normalizeOverrideFields, repoNameFromFullName } from './repository-identity.mjs';",
)
replace_once(
    'scripts/validate.mjs',
    "    if (!p.full_name || !p.full_name.includes('/')) errors.push(`full_name 非法: ${p.slug}`);",
    "    if (!isValidRepositoryName(p.full_name)) errors.push(`full_name 非法: ${p.slug}`);",
)
replace_once(
    'scripts/validate.mjs',
    "    if (p.repo_name && p.repo_name !== repoNameFromFullName(p.full_name)) errors.push(`repo_name 与 full_name 不一致: ${p.full_name}`);\n    if (p.repo_url && p.repo_url !== canonicalRepoUrl(p.full_name)) errors.push(`repo_url 非 canonical GitHub 地址: ${p.full_name}`);\n    if (p.install_cmd && p.install_cmd !== makeInstallCmd(p.full_name, p.category || 'other')) errors.push(`install_cmd 与仓库身份不一致: ${p.full_name}`);\n    if (p.metadata_source === 'github' && p.name !== repoNameFromFullName(p.full_name)) errors.push(`GitHub 来源名称与仓库名不一致: ${p.full_name} -> ${p.name}`);",
    "    if (p.repo_name !== repoNameFromFullName(p.full_name)) errors.push(`repo_name 与 full_name 不一致: ${p.full_name}`);\n    if (p.repo_url !== canonicalRepoUrl(p.full_name)) errors.push(`repo_url 非 canonical GitHub 地址: ${p.full_name}`);\n    if (p.install_cmd !== makeInstallCmd(p.full_name, p.category || 'other')) errors.push(`install_cmd 与仓库身份不一致: ${p.full_name}`);\n    const overrideFields = normalizeOverrideFields(p.override_fields);\n    if (!['github', 'dsh-plugin', 'override'].includes(p.metadata_source)) errors.push(`metadata_source 非法: ${p.full_name} -> ${p.metadata_source}`);\n    if (p.metadata_source === 'github' && p.name !== repoNameFromFullName(p.full_name)) errors.push(`GitHub 来源名称与仓库名不一致: ${p.full_name} -> ${p.name}`);\n    if (p.metadata_source === 'github' && (p.verified || p.manifest_file)) errors.push(`GitHub 来源不能携带 verified/manifest: ${p.full_name}`);\n    if (p.metadata_source === 'dsh-plugin' && (p.manifest_file !== 'dsh-plugin.json' || !p.verified)) errors.push(`dsh-plugin 来源缺少可信 manifest 状态: ${p.full_name}`);\n    if (p.metadata_source === 'override' && overrideFields.length === 0) errors.push(`override 来源缺少字段级来源: ${p.full_name}`);\n    if (Array.isArray(p.override_fields) && overrideFields.length !== p.override_fields.length) errors.push(`override_fields 非法: ${p.full_name}`);\n    if (p.homepage && normalizeHttpUrl(p.homepage) !== p.homepage) errors.push(`homepage 非法或未规范化: ${p.full_name}`);\n    if (p.deprecated !== undefined && typeof p.deprecated !== 'boolean') errors.push(`deprecated 非布尔: ${p.full_name}`);\n    if (p.disabled !== undefined && typeof p.disabled !== 'boolean') errors.push(`disabled 非布尔: ${p.full_name}`);",
)
replace_once(
    'scripts/validate.mjs',
    "    if (!p.install_cmd) warns.push(`缺少 install_cmd: ${p.slug}`);\n",
    "",
)

replace_once(
    'tests/validate.test.ts',
    "  it('缺少 install_cmd 产生警告而非错误', () => {\n    const c = goodCatalog();\n    delete (c.plugins[0] as Record<string, unknown>).install_cmd;\n    const { errors, warns } = validateCatalog(c);\n    expect(errors).toEqual([]);\n    expect(warns.some((w) => w.includes('install_cmd'))).toBe(true);\n  });",
    "  it('缺少 canonical install_cmd 直接阻断', () => {\n    const c = goodCatalog();\n    delete (c.plugins[0] as Record<string, unknown>).install_cmd;\n    expect(validateCatalog(c).errors.some((e) => e.includes('install_cmd 与仓库身份不一致'))).toBe(true);\n  });\n\n  it('拒绝无字段来源的 legacy override 与危险 homepage', () => {\n    const c = goodCatalog();\n    c.plugins[1].metadata_source = 'override';\n    (c.plugins[1] as Record<string, unknown>).homepage = 'javascript:alert(1)';\n    const errors = validateCatalog(c).errors;\n    expect(errors.some((e) => e.includes('override 来源缺少字段级来源'))).toBe(true);\n    expect(errors.some((e) => e.includes('homepage 非法'))).toBe(true);\n  });",
)

replace_once(
    'tests/registry-v3.test.ts',
    "});\n\ndescribe('Runtime resolver', () => {",
    "  it('excludes archived or disabled repositories from the installable registry', async () => {\n    const commit = '0123456789abcdef0123456789abcdef01234567';\n    const catalog: any = {\n      meta: { etag: 'abc', count: 3 },\n      plugins: [\n        { slug: 'owner-active', full_name: 'owner/active', name: 'active', category: 'tool', snapshot_commit: commit, snapshot_ref: 'main' },\n        { slug: 'owner-archived', full_name: 'owner/archived', name: 'archived', category: 'tool', snapshot_commit: commit, snapshot_ref: 'main', deprecated: true },\n        { slug: 'owner-disabled', full_name: 'owner/disabled', name: 'disabled', category: 'tool', snapshot_commit: commit, snapshot_ref: 'main', disabled: true },\n      ],\n    };\n    const { registry, stats } = await buildRegistryV3(catalog, null, { discoveryMode: 'complete', discoveredCount: 3 });\n    expect(registry.plugins.map((p: any) => p.source.repo)).toEqual(['owner/active']);\n    expect(stats.excluded.some((x: any) => x.reason.includes('archived'))).toBe(true);\n    expect(stats.excluded.some((x: any) => x.reason.includes('disabled'))).toBe(true);\n  });\n});\n\ndescribe('Runtime resolver', () => {",
)

Path('tests/catalog-filter.test.ts').write_text("""import { describe, expect, it } from 'vitest';
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
""")
