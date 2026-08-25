#!/usr/bin/env node
/** DSH Go legacy catalog validation gate (V2 compatibility surface). */
import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalRepoKey, canonicalRepoUrl, makeInstallCmd, repoNameFromFullName } from './repository-identity.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGINS_FILE = resolve(ROOT, 'catalog/plugins.json');

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
    if (slugs.has(p.slug)) errors.push(`slug 重复: ${p.slug}`);
    slugs.add(p.slug);
    if (!p.full_name || !p.full_name.includes('/')) errors.push(`full_name 非法: ${p.slug}`);
    const repoKey = canonicalRepoKey(p.full_name);
    if (repos.has(repoKey)) errors.push(`full_name 大小写归一后重复: ${p.full_name}`);
    repos.add(repoKey);
    if (p.repo_id) { const repoId = String(p.repo_id); if (repoIds.has(repoId)) errors.push(`repo_id 重复: ${repoId}`); repoIds.add(repoId); }
    if (p.repo_name && p.repo_name !== repoNameFromFullName(p.full_name)) errors.push(`repo_name 与 full_name 不一致: ${p.full_name}`);
    if (p.repo_url && p.repo_url !== canonicalRepoUrl(p.full_name)) errors.push(`repo_url 非 canonical GitHub 地址: ${p.full_name}`);
    if (p.install_cmd && p.install_cmd !== makeInstallCmd(p.full_name, p.category || 'other')) errors.push(`install_cmd 与仓库身份不一致: ${p.full_name}`);
    if (p.metadata_source === 'github' && p.name !== repoNameFromFullName(p.full_name)) errors.push(`GitHub 来源名称与仓库名不一致: ${p.full_name} -> ${p.name}`);
    if (typeof p.stars !== 'number' || p.stars < 0) errors.push(`stars 非法: ${p.slug}`);
    if (!p.install_cmd) warns.push(`缺少 install_cmd: ${p.slug}`);
    if (typeof p.verified !== 'boolean') warns.push(`verified 非布尔: ${p.slug}`);
    if (p.manifest_file && p.manifest_file !== 'dsh-plugin.json') errors.push(`非法 manifest_file（仅允许 dsh-plugin.json）: ${p.slug} -> ${p.manifest_file}`);
    if (p.verified && p.manifest_file !== 'dsh-plugin.json') errors.push(`verified 必须由 dsh-plugin.json 提供: ${p.slug}`);
    if (!p.category) warns.push(`缺少 category: ${p.slug}`);
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
