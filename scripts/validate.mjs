#!/usr/bin/env node
/** DSH Go legacy catalog validation gate (V2 compatibility surface). */
import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DSH_MANIFEST_FILES, canonicalRepoKey, canonicalRepoUrl, isValidRepositoryName, makeInstallCmd, normalizeHttpUrl, normalizeOverrideFields, repoNameFromFullName } from './repository-identity.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGINS_FILE = resolve(ROOT, 'catalog/plugins.json');
const VALID_CATEGORIES = new Set(['web-ui', 'desktop', 'mcp', 'skills', 'theme', 'terminal', 'coding', 'agent', 'vision', 'memory', 'security', 'integration', 'tool', 'other']);
const DSH_MANIFEST_SET = new Set(DSH_MANIFEST_FILES);
const DSH_METADATA_SOURCES = new Set(DSH_MANIFEST_FILES.map((file) => file.replace(/\.json$/, '')));

export function validateCatalog(data) {
  const errors = [];
  const warns = [];
  if (data.version !== 2) errors.push('version 字段必须是 2');
  if (!Array.isArray(data.plugins)) return { errors: [...errors, 'plugins 必须是数组'], warns };
  if (!data.meta || !data.meta.etag) errors.push('缺少 meta.etag');

  const slugs = new Set();
  const repos = new Set();
  const repoIds = new Set();
  for (const p of data.plugins) {
    if (!p.slug) errors.push(`存在缺少 slug 的插件: ${p.full_name || 'unknown'}`);
    const slugKey = String(p.slug || '').toLowerCase();
    if (p.slug && !/^[A-Za-z0-9_.-]+$/.test(p.slug)) errors.push(`slug 非法: ${p.slug}`);
    if (slugs.has(slugKey)) errors.push(`slug 大小写归一后重复: ${p.slug}`);
    slugs.add(slugKey);
    if (!isValidRepositoryName(p.full_name)) errors.push(`full_name 非法: ${p.slug}`);
    const repoKey = canonicalRepoKey(p.full_name);
    if (repos.has(repoKey)) errors.push(`full_name 大小写归一后重复: ${p.full_name}`);
    repos.add(repoKey);
    if (p.repo_id) { const repoId = String(p.repo_id); if (repoIds.has(repoId)) errors.push(`repo_id 重复: ${repoId}`); repoIds.add(repoId); }
    if (p.repo_name !== repoNameFromFullName(p.full_name)) errors.push(`repo_name 与 full_name 不一致: ${p.full_name}`);
    if (p.repo_url !== canonicalRepoUrl(p.full_name)) errors.push(`repo_url 非 canonical GitHub 地址: ${p.full_name}`);
    if (p.install_cmd !== makeInstallCmd(p.full_name, p.category || 'other')) errors.push(`install_cmd 与仓库身份不一致: ${p.full_name}`);
    const overrideFields = normalizeOverrideFields(p.override_fields);
    if (!['github', ...DSH_METADATA_SOURCES, 'override'].includes(p.metadata_source)) errors.push(`metadata_source 非法: ${p.full_name} -> ${p.metadata_source}`);
    if (p.metadata_source === 'github' && p.name !== repoNameFromFullName(p.full_name)) errors.push(`GitHub 来源名称与仓库名不一致: ${p.full_name} -> ${p.name}`);
    if (p.metadata_source === 'github' && (p.verified || p.manifest_file)) errors.push(`GitHub 来源不能携带 verified/manifest: ${p.full_name}`);
    if (DSH_METADATA_SOURCES.has(p.metadata_source) && (p.manifest_file !== `${p.metadata_source}.json` || !p.verified)) errors.push(`${p.metadata_source} 来源缺少可信 manifest 状态: ${p.full_name}`);
    if (p.metadata_source === 'override' && overrideFields.length === 0) errors.push(`override 来源缺少字段级来源: ${p.full_name}`);
    if (Array.isArray(p.override_fields) && overrideFields.length !== p.override_fields.length) errors.push(`override_fields 非法: ${p.full_name}`);
    if (p.homepage && normalizeHttpUrl(p.homepage) !== p.homepage) errors.push(`homepage 非法或未规范化: ${p.full_name}`);
    if (p.deprecated !== undefined && typeof p.deprecated !== 'boolean') errors.push(`deprecated 非布尔: ${p.full_name}`);
    if (p.disabled !== undefined && typeof p.disabled !== 'boolean') errors.push(`disabled 非布尔: ${p.full_name}`);
    if (typeof p.stars !== 'number' || p.stars < 0) errors.push(`stars 非法: ${p.slug}`);
    if (typeof p.verified !== 'boolean') warns.push(`verified 非布尔: ${p.slug}`);
    if (p.manifest_file && !DSH_MANIFEST_SET.has(p.manifest_file)) errors.push(`非法 manifest_file（仅允许受支持 DSH manifest）: ${p.slug} -> ${p.manifest_file}`);
    if (p.verified && !DSH_MANIFEST_SET.has(p.manifest_file)) errors.push(`verified 必须由 dsh-plugin.json 或其他受支持 DSH manifest 提供: ${p.slug}`);
    if (!p.category) warns.push(`缺少 category: ${p.slug}`);
    else if (!VALID_CATEGORIES.has(p.category)) errors.push(`category 非法: ${p.slug} -> ${p.category}`);
  }
  if (data.meta?.count !== data.plugins.length) errors.push(`meta.count (${data.meta?.count}) 与 plugins 实际数量 (${data.plugins.length}) 不一致`);
  return { errors, warns };
}

function isMainModule() {
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]); } catch { return false; }
}

async function main() {
  const data = JSON.parse(await readFile(PLUGINS_FILE, 'utf8'));
  const { errors, warns } = validateCatalog(data);
  warns.forEach((warning) => console.warn('[WARN]', warning));
  if (errors.length) { errors.forEach((error) => console.error('[ERROR]', error)); process.exit(1); }
  console.log(`Legacy catalog validation passed: ${data.plugins.length} plugins, etag=${data.meta.etag}`);
}

if (isMainModule()) main().catch((error) => { console.error('[ERROR]', error.message); process.exit(1); });
