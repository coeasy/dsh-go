#!/usr/bin/env node
/**
 * DSH Go — 数据校验门禁
 * 在部署前检查 catalog 数据合法性，失败则中断流水线（exit 1）
 */
import { readFile, access } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PLUGINS_FILE = resolve(ROOT, 'catalog/plugins.json');

/**
 * 纯函数：校验 catalog 数据结构，返回错误与警告列表（不依赖 IO / 不退出进程）
 */
export function validateCatalog(data) {
  const errors = [];
  const warns = [];

  if (data.version !== 2) errors.push('version 字段必须是 2');
  if (!Array.isArray(data.plugins)) errors.push('plugins 必须是数组');
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
    if (!p.category) warns.push(`缺少 category: ${p.slug}`);
  }

  if (data.meta.count !== data.plugins.length) {
    errors.push(`meta.count (${data.meta.count}) 与 plugins 实际数量 (${data.plugins.length}) 不一致`);
  }

  return { errors, warns };
}

async function main() {
  await access(PLUGINS_FILE);
  const data = JSON.parse(await readFile(PLUGINS_FILE, 'utf-8'));
  const { errors, warns } = validateCatalog(data);

  for (const w of warns) console.warn(`[WARN] ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`[ERROR] ${e}`);
    console.error(`校验失败：${errors.length} 个错误`);
    process.exit(1);
  }
  console.log(`✅ 校验通过：${data.plugins.length} 个插件，meta.etag=${data.meta.etag}`);
}

// 仅当作为 CLI 直接运行时执行（被测试 import 时不触发 IO）
// 用 realpathSync 兼容 Windows：file:// URL 与本地路径需归一化后再比对
function isMainModule() {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}
if (isMainModule()) {
  main().catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
}
