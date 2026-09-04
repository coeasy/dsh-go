#!/usr/bin/env node
/** Canonical build-time asset pipeline for Registry V4 / Distribution V2 / Search Index V3. */
import { access, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { buildRegistryV4 } from '../packages/registry-core/index.mjs';
import { buildSearchIndexV3 } from './build-search-index-v3.mjs';
import { writeRegistryDistributionV2 } from './registry-distribution-v2.mjs';

function findRoot() {
  const bases = [process.cwd(), dirname(fileURLToPath(import.meta.url))];
  for (const base of bases) {
    let current = base;
    for (let depth = 0; depth < 6; depth += 1) {
      if (existsSync(join(current, 'package.json')) && existsSync(join(current, 'scripts', 'copy-assets.mjs'))) return current;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return process.cwd();
}

const ROOT = findRoot();
const CATALOG_DIR = resolve(ROOT, 'catalog');
const TARGET_DIR = resolve(ROOT, 'site/public/catalog');
const SCRIPTS_SRC = resolve(ROOT, 'site/src/scripts');
const SCRIPTS_DST = resolve(ROOT, 'site/public/scripts');
const REGISTRY_SOURCE = resolve(CATALOG_DIR, process.env.DSH_REGISTRY_SOURCE_FILE || 'registry-v3.json');
const REGISTRY_V4_FILE = resolve(CATALOG_DIR, 'registry-v4.json');

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function buildCanonicalRegistry() {
  if (!(await exists(REGISTRY_SOURCE))) throw new Error(`Registry build source is missing: ${REGISTRY_SOURCE}`);
  const source = JSON.parse(await readFile(REGISTRY_SOURCE, 'utf8'));
  const records = Array.isArray(source.plugins) ? source.plugins : Array.isArray(source.packages) ? source.packages : [];
  if (!records.length) throw new Error('Registry build source contains no records');
  const registry = buildRegistryV4(records, {
    generated_at: process.env.DSH_GENERATED_AT || source.generated?.at || new Date().toISOString(),
    source: 'dsh-go-canonical-build',
  });
  await writeFile(REGISTRY_V4_FILE, `${JSON.stringify(registry)}\n`, 'utf8');
  await writeFile(resolve(TARGET_DIR, 'registry-v4.json'), `${JSON.stringify(registry)}\n`, 'utf8');
  return registry;
}

async function copyOptionalJson(file) {
  const source = resolve(CATALOG_DIR, file);
  if (!(await exists(source))) return false;
  const payload = JSON.parse(await readFile(source, 'utf8'));
  await writeFile(resolve(TARGET_DIR, file), `${JSON.stringify(payload)}\n`, 'utf8');
  return true;
}

async function removeLegacyPublicSurfaces() {
  for (const path of [
    resolve(TARGET_DIR, 'registry-v3.json'),
    resolve(TARGET_DIR, 'schema-v3.json'),
    resolve(TARGET_DIR, 'search-index-v2.json'),
    resolve(TARGET_DIR, 'distribution-v1'),
    resolve(TARGET_DIR, 'plugins.json'),
    resolve(TARGET_DIR, 'catalog-v3'),
    resolve(ROOT, 'site/public/install'),
  ]) {
    await rm(path, { recursive: true, force: true });
  }
}

async function syncBrowserScripts() {
  try {
    const files = (await readdir(SCRIPTS_SRC)).filter((file) => file.endsWith('.js'));
    await mkdir(SCRIPTS_DST, { recursive: true });
    for (const file of files) await cp(resolve(SCRIPTS_SRC, file), resolve(SCRIPTS_DST, file));
  } catch (error) {
    console.warn('Browser script asset sync failed:', error instanceof Error ? error.message : String(error));
  }
}

async function main() {
  await mkdir(TARGET_DIR, { recursive: true });
  await removeLegacyPublicSurfaces();
  const registry = await buildCanonicalRegistry();

  const searchIndex = buildSearchIndexV3(registry);
  await writeFile(resolve(TARGET_DIR, 'search-index-v3.json'), `${JSON.stringify(searchIndex)}\n`, 'utf8');

  const distribution = await writeRegistryDistributionV2(registry, resolve(TARGET_DIR, 'registry-v4'));
  await copyOptionalJson('meta.json');
  await copyOptionalJson('provider-adapters.json');

  if (await exists(resolve(CATALOG_DIR, 'feed.xml'))) await cp(resolve(CATALOG_DIR, 'feed.xml'), resolve(ROOT, 'site/public/feed.xml'));
  for (const file of ['_headers', '_redirects']) {
    const source = resolve(ROOT, file);
    if (await exists(source)) await cp(source, resolve(ROOT, 'site/public', file));
  }
  await syncBrowserScripts();

  console.log(`Canonical assets ready: Registry V4 ${registry.metadata.package_count} packages, Search Index V3 ${searchIndex.count} items, Distribution V2 ${distribution.package_count} shards`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
