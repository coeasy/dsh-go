#!/usr/bin/env node
/** Build-time asset copier + compact catalog/install/search/registry distribution generator. */
import { mkdir, cp, readFile, access, writeFile, readdir, unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { buildSearchIndex } from './build-search-index-v2.mjs';
import { writeRegistryDistribution } from './registry-distribution.mjs';
import { buildLegacyPublicCatalog, writeCatalogDistribution } from './catalog-distribution.mjs';

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
const DETAIL_THRESHOLD = 100;
async function exists(path) { try { await access(path); return true; } catch { return false; } }

function shTemplate(installCmd) {
  return `#!/usr/bin/env bash\n# DSH Plugin one-click installer (generated)\nset -euo pipefail\necho "Installing package through DSH CLI ..."\nif command -v dsh >/dev/null 2>&1; then\n  ${installCmd}\nelse\n  echo "dsh CLI not found. See https://get.dsh.dev"\n  exit 1\nfi\n`;
}
function psTemplate(installCmd) {
  return `# DSH Plugin one-click installer (generated)\nWrite-Host "Installing package through DSH CLI ..."\nif (Get-Command dsh -ErrorAction SilentlyContinue) {\n  ${installCmd}\n} else {\n  Write-Host "dsh CLI not found. See https://get.dsh.dev"\n  exit 1\n}\n`;
}

function safeRepository(value) {
  const repository = String(value || '').trim();
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ? repository : null;
}

function safeSlug(value) {
  const slug = String(value || '').trim();
  return /^[A-Za-z0-9_.-]+$/.test(slug) ? slug : null;
}

function shellArg(value) {
  return `'${String(value).replaceAll("'", "'\\\"'\\\"'")}'`;
}

function powershellArg(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function genInstallScripts() {
  const src = resolve(CATALOG_DIR, 'plugins.json');
  if (!(await exists(src))) { console.warn('Missing plugins.json; skipping install scripts'); return; }
  const data = JSON.parse(await readFile(src, 'utf8'));
  await mkdir(INSTALL_DIR, { recursive: true });
  const wanted = new Set((data.plugins || [])
    .filter((plugin) => !plugin.deprecated && !plugin.disabled && (plugin.stars || 0) >= DETAIL_THRESHOLD)
    .map((plugin) => safeSlug(plugin.slug))
    .filter(Boolean)
    .flatMap((slug) => [`${slug}.sh`, `${slug}.ps1`]));
  try {
    for (const file of await readdir(INSTALL_DIR)) {
      if ((file.endsWith('.sh') || file.endsWith('.ps1')) && !wanted.has(file)) await unlink(resolve(INSTALL_DIR, file));
    }
  } catch { /* directory may be new */ }

  let generated = 0;
  for (const plugin of data.plugins || []) {
    if (plugin.deprecated || plugin.disabled || (plugin.stars || 0) < DETAIL_THRESHOLD) continue;
    const full = safeRepository(plugin.full_name);
    const slug = safeSlug(plugin.slug);
    if (!full || !slug) continue;
    // The catalog is assembled from third-party repositories. Never embed a
    // catalog-provided command verbatim in a downloadable shell/PowerShell
    // script; derive the command from the validated immutable repository id.
    const installSpec = `github:${full}`;
    const installCmd = `dsh plugin install ${shellArg(installSpec)}`;
    const powershellInstallCmd = `dsh plugin install ${powershellArg(installSpec)}`;
    await writeFile(resolve(INSTALL_DIR, `${slug}.sh`), shTemplate(installCmd), 'utf8');
    await writeFile(resolve(INSTALL_DIR, `${slug}.ps1`), psTemplate(powershellInstallCmd), 'utf8');
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

async function genRegistryDistribution() {
  const registryFile = resolve(CATALOG_DIR, 'registry-v3.json');
  if (!(await exists(registryFile))) { console.warn('Missing registry-v3.json; skipping Registry Distribution'); return; }
  const registry = JSON.parse(await readFile(registryFile, 'utf8'));
  const deltaFile = resolve(CATALOG_DIR, 'distribution-delta.json');
  const delta = await exists(deltaFile) ? JSON.parse(await readFile(deltaFile, 'utf8')) : null;
  const result = await writeRegistryDistribution(
    registry,
    resolve(TARGET_DIR, 'distribution-v1'),
    { delta, concurrency: Number(process.env.REGISTRY_DISTRIBUTION_WRITE_CONCURRENCY || 32) },
  );
  console.log(`Generated Registry Distribution V1 (${result.records} records, ${result.packages} packages, ${result.shards} shards, hash=${result.content_hash})`);
}

async function genCatalogDistribution() {
  const catalogFile = resolve(CATALOG_DIR, 'plugins.json');
  if (!(await exists(catalogFile))) { console.warn('Missing plugins.json; skipping Catalog Distribution'); return; }
  const catalog = JSON.parse(await readFile(catalogFile, 'utf8'));
  const distribution = await writeCatalogDistribution(catalog, resolve(TARGET_DIR, 'catalog-v3'), {
    maxShardBytes: Number(process.env.CATALOG_SHARD_MAX_BYTES || 2 * 1024 * 1024),
  });
  const legacy = buildLegacyPublicCatalog(catalog);
  await writeFile(resolve(TARGET_DIR, 'plugins.json'), legacy.text, 'utf8');
  console.log(`Generated Catalog Distribution V1 (${distribution.count} records, ${distribution.shards} shards, max=${distribution.max_shard_bytes} bytes)`);
  console.log(`Generated compact legacy plugins.json (${legacy.bytes} bytes, readme_excerpt<=${legacy.excerptLimit}, description<=${legacy.descriptionLimit})`);
}

async function copyJsonMinified(file) {
  const src = resolve(CATALOG_DIR, file);
  if (!(await exists(src))) return false;
  const data = JSON.parse(await readFile(src, 'utf8'));
  await writeFile(resolve(TARGET_DIR, file), `${JSON.stringify(data)}\n`, 'utf8');
  console.log(`Minified ${file} -> site/public/catalog/`);
  return true;
}

async function main() {
  await mkdir(TARGET_DIR, { recursive: true });
  await genCatalogDistribution();
  for (const file of ['meta.json', 'registry-v3.json', 'schema-v3.json', 'provider-adapters.json']) {
    const copied = await copyJsonMinified(file);
    if (!copied && file === 'registry-v3.json') console.warn('Missing registry-v3.json; run npm run registry:migrate or npm run sync first');
  }
  await genRegistryDistribution();
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
