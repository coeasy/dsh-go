#!/usr/bin/env node
/**
 * DSH Plugins Nav — 构建前资源拷贝
 * 把 catalog/*.json 与 catalog/feed.xml 拷入 site/public/catalog/
 * （Astro 会把 public/ 原样复制到 dist/，这样 Functions 能通过 ASSETS 读取）
 * 同时把根级 _headers / _redirects 同步到 site/public/
 * 并把 src/scripts/*.js 同步到 site/public/scripts/
 * 最后为每个插件生成一键安装脚本 site/public/install/<slug>.{sh,ps1}
 */
import { mkdir, cp, readFile, access, writeFile, readdir, unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

// 兼容沙箱可能把脚本拷贝到临时目录执行的情况：
// 从 cwd 与脚本所在目录分别向上查找「含 package.json 且含 scripts/copy-assets.mjs」的项目根
function findRoot() {
  const bases = [process.cwd(), dirname(fileURLToPath(import.meta.url))];
  for (const base of bases) {
    let cur = base;
    for (let i = 0; i < 6; i++) {
      if (existsSync(join(cur, 'package.json')) && existsSync(join(cur, 'scripts', 'copy-assets.mjs'))) {
        return cur;
      }
      const parent = dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }
  return process.cwd();
}

const ROOT = findRoot();
const CATALOG_DIR = resolve(ROOT, 'catalog');
const TARGET_DIR = resolve(ROOT, 'site/public/catalog');
const SCRIPTS_SRC = resolve(ROOT, 'site/src/scripts');
const SCRIPTS_DST = resolve(ROOT, 'site/public/scripts');
const INSTALL_DIR = resolve(ROOT, 'site/public/install');
// 详情页门槛：与 site 侧一致，仅 stars >= 500 的插件生成一键安装脚本（控制文件数量）
const DETAIL_THRESHOLD = 500;

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

function shTemplate(installCmd) {
  return `#!/usr/bin/env bash
# DSH Plugin 一键安装脚本（自动生成）
set -euo pipefail
echo "正在通过 DSH CLI 安装插件 ..."
if command -v dsh >/dev/null 2>&1; then
  ${installCmd}
else
  echo "未检测到 dsh CLI，请先安装："
  echo "官方文档: https://get.dsh.dev"
  exit 1
fi
`;
}

function psTemplate(installCmd) {
  return `# DSH Plugin 一键安装脚本（自动生成，Windows）
Write-Host "正在通过 DSH CLI 安装插件 ..."
if (Get-Command dsh -ErrorAction SilentlyContinue) {
  ${installCmd}
} else {
  Write-Host "未检测到 dsh CLI，请先安装："
  Write-Host "官方文档: https://get.dsh.dev"
  exit 1
}
`;
}

async function genInstallScripts() {
  const src = resolve(CATALOG_DIR, 'plugins.json');
  if (!(await exists(src))) {
    console.warn('⚠️ 缺少 plugins.json（首次运行请先执行 npm run sync），跳过安装脚本生成');
    return;
  }
  const data = JSON.parse(await readFile(src, 'utf-8'));
  await mkdir(INSTALL_DIR, { recursive: true });
  // 清理已移除插件的旧脚本，避免残留（清理全部，wanted 只含门槛内）
  try {
    const wanted = new Set(
      (data.plugins || [])
        .filter((p) => (p.stars || 0) >= DETAIL_THRESHOLD)
        .flatMap((p) => [`${p.slug}.sh`, `${p.slug}.ps1`])
    );
    const old = await readdir(INSTALL_DIR);
    for (const f of old) {
      if ((f.endsWith('.sh') || f.endsWith('.ps1')) && !wanted.has(f)) {
        try { await unlink(resolve(INSTALL_DIR, f)); } catch { /* 忽略删除失败 */ }
      }
    }
  } catch { /* 忽略 */ }
  // 门槛统计：仅 count ≥ threshold 的插件生成脚本
  let generated = 0;
  for (const p of data.plugins || []) {
    // 仅门槛内插件生成安装脚本（低星插件不做一键安装，卡片跳 GitHub）
    if ((p.stars || 0) < DETAIL_THRESHOLD) continue;
    const full = p.full_name || p.slug.replace('-', '/');
    if (!full) continue;
    // 与 API /catalog 中 install_cmd 保持一致（分类 profile 由 sync 已算好）
    const installCmd = p.install_cmd || `dsh plugin add github:${full}`;
    await writeFile(resolve(INSTALL_DIR, `${p.slug}.sh`), shTemplate(installCmd), 'utf-8');
    await writeFile(resolve(INSTALL_DIR, `${p.slug}.ps1`), psTemplate(installCmd), 'utf-8');
    generated++;
  }
  console.log(`✅ 生成 ${generated * 2} 个一键安装脚本（门槛 stars>=${DETAIL_THRESHOLD}）-> site/public/install/`);
}

async function main() {
  await mkdir(TARGET_DIR, { recursive: true });
  for (const f of ['plugins.json', 'meta.json']) {
    try {
      await access(resolve(CATALOG_DIR, f));
      await cp(resolve(CATALOG_DIR, f), resolve(TARGET_DIR, f));
      console.log(`✅ 拷贝 ${f} -> site/public/catalog/`);
    } catch {
      console.warn(`⚠️ 缺少 ${f}（首次运行请先执行 npm run sync）`);
    }
  }
  // feed.xml 作为站点根路径的 RSS（/feed.xml）
  try {
    await access(resolve(CATALOG_DIR, 'feed.xml'));
    await cp(resolve(CATALOG_DIR, 'feed.xml'), resolve(ROOT, 'site/public/feed.xml'));
    console.log('✅ 拷贝 feed.xml -> site/public/feed.xml');
  } catch {
    console.warn('⚠️ 缺少 feed.xml（首次运行请先执行 npm run sync）');
  }
  // 根级 _headers / _redirects（若存在）同步到 public
  for (const f of ['_headers', '_redirects']) {
    try {
      const src = resolve(ROOT, f);
      await access(src);
      await cp(src, resolve(ROOT, 'site/public', f));
      console.log(`✅ 同步 ${f} -> site/public/`);
    } catch { /* 根级无该文件则跳过 */ }
  }
  // src/scripts/*.js -> public/scripts/
  try {
    const files = await readdir(SCRIPTS_SRC);
    await mkdir(SCRIPTS_DST, { recursive: true });
    for (const f of files.filter((f) => f.endsWith('.js'))) {
      await cp(resolve(SCRIPTS_SRC, f), resolve(SCRIPTS_DST, f));
    }
    console.log(`✅ 同步脚本 -> site/public/scripts/ (${files.filter((f) => f.endsWith('.js')).length} 个)`);
  } catch (e) {
    console.warn('⚠️ 同步 scripts 失败：', e.message);
  }
  // 生成一键安装脚本
  await genInstallScripts();
}

main().catch((e) => { console.error(e); process.exit(1); });
