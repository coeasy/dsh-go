#!/usr/bin/env node
/** DSH Go legacy catalog validation gate (V2 compatibility surface). */
import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGINS_FILE = resolve(ROOT, 'catalog/plugins.json');

export function validateCatalog(data) {
  const errors = [];
  const warns = [];
  if (data.version !== 2) errors.push('version 字段必须是 2');
  if (!Array.isArray(data.plugins)) return { errors: [...errors, 'plugins 必须是数组'], warns };
  if (!data.meta || !data.meta.etag) errors.push('缺少 meta.etag');

  const slugs = new Set();
  for (const p of data.plugins) {
    if (!p.slug) errors.push(`存在缺少 slug 的插件: ${p.full_name || 'unknown'}`);
    if (slugs.has(p.slug)) errors.push(`slug 重复: ${p.slug}`);
    slugs.add(p.slug);
    if (!p.full_name || !p.full_name.includes('/')) errors.push(`full_name 非法: ${p.slug}`);
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
