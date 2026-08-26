#!/usr/bin/env node
/** Build-time asset copier + install-script/search-index generator. */
import { mkdir, cp, readFile, access, writeFile, readdir, unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { buildSearchIndex } from './build-search-index-v2.mjs';

function findRoot() {
  const bases = [process.cwd(), dirname(fileURLToPath(import.meta.url))];
  for (const base of bases) {
    let cur = base;
    for (let i = 0; i < 6; i++) {
      if (existsSync(join(cur, 'package.json')) && existsSync(join(cur, 'scripts', 'copy-assets.mjs'))) return cur;
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
const DETAIL_THRESHOLD = 200;
async function exists(path) { try { await access(path); return true; } catch { return false; } }

function shTemplate(installCmd) {
  return `#!/usr/bin/env bash\n# DSH Plugin one-click installer (generated)\nset -euo pipefail\necho "Installing package through DSH CLI ..."\nif command -v dsh >/dev/null 2>&1; then\n  ${installCmd}\nelse\n  echo "dsh CLI not found. See https://get.dsh.dev"\n  exit 1\nfi\n`;
}
function psTemplate(installCmd) {
  return `# DSH Plugin one-click installer (generated)\nWrite-Host "Installing package through DSH CLI ..."\nif (Get-Command dsh -ErrorAction SilentlyContinue) {\n  ${installCmd}\n} else {\n  Write-Host "dsh CLI not found. See https://get.dsh.dev"\n  exit 1\n}\n`;
}

async function genInstallScripts() {
  const src = resolve(CATALOG_DIR, 'plugins.json');
  if (!(await exists(src))) { console.warn('Missing plugins.json; skipping install scripts'); return; }
  const data = JSON.parse(await readFile(src, 'utf8'));
  await mkdir(INSTALL_DIR, { recursive: true });
  const wanted = new Set((data.plugins || []).filter((plugin) => !plugin.deprecated && !plugin.disabled && (plugin.stars || 0) >= DETAIL_THRESHOLD).flatMap((plugin) => [`${plugin.slug}.sh`, `${plugin.slug}.ps1`]));
  try {
    for (const file of await readdir(INSTALL_DIR)) {
      if ((file.endsWith('.sh') || file.endsWith('.ps1')) && !wanted.has(file)) await unlink(resolve(INSTALL_DIR, file));
    }
  } catch { /* directory may be new */ }

  let generated = 0;
  for (const plugin of data.plugins || []) {
    if (plugin.deprecated || plugin.disabled || (plugin.stars || 0) < DETAIL_THRESHOLD) continue;
    const full = plugin.full_name || '';
    if (!full || !plugin.slug) continue;
    const installCmd = plugin.install_cmd || `dsh plugin add github:${full}`;
    await writeFile(resolve(INSTALL_DIR, `${plugin.slug}.sh`), shTemplate(installCmd), 'utf8');
    await writeFile(resolve(INSTALL_DIR, `${plugin.slug}.ps1`), psTemplate(installCmd), 'utf8');
    generated++;
  }
  console.log(`Generated ${generated * 2} install scripts`);
}

async function genSearchIndex() {
  const src = resolve(CATALOG_DIR, 'registry-v3.json');
  if (!(await exists(src))) { console.warn('Missing registry-v3.json; skipping Search Index V2'); return; }
  const registry = JSON.parse(await readFile(src, 'utf8'));
  const index = buildSearchIndex(registry);
  await writeFile(resolve(TARGET_DIR, 'search-index-v2.json'), `${JSON.stringify(index)}\n`, 'utf8');
  console.log(`Generated Search Index V2 (${index.count} packages)`);
}

async function main() {
  await mkdir(TARGET_DIR, { recursive: true });
  for (const file of ['plugins.json', 'meta.json', 'registry-v3.json', 'schema-v3.json']) {
    const src = resolve(CATALOG_DIR, file);
    if (await exists(src)) { await cp(src, resolve(TARGET_DIR, file)); console.log(`Copied ${file} -> site/public/catalog/`); }
    else if (file === 'registry-v3.json') console.warn('Missing registry-v3.json; run npm run registry:migrate or npm run sync first');
  }
  await genSearchIndex();
  if (await exists(resolve(CATALOG_DIR, 'feed.xml'))) await cp(resolve(CATALOG_DIR, 'feed.xml'), resolve(ROOT, 'site/public/feed.xml'));
  for (const file of ['_headers', '_redirects']) {
    const src = resolve(ROOT, file);
    if (await exists(src)) await cp(src, resolve(ROOT, 'site/public', file));
  }
  try {
    const files = (await readdir(SCRIPTS_SRC)).filter((file) => file.endsWith('.js'));
    await mkdir(SCRIPTS_DST, { recursive: true });
    for (const file of files) await cp(resolve(SCRIPTS_SRC, file), resolve(SCRIPTS_DST, file));
  } catch (error) { console.warn('Script asset sync failed:', error.message); }
  await genInstallScripts();
}
main().catch((error) => { console.error(error); process.exit(1); });
