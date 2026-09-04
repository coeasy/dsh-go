#!/usr/bin/env node
/** Canonical build-time asset pipeline for Registry V4 / Distribution V2 / Search Index V3. */
import { access, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { validateRegistryV4 } from '../packages/registry-core/index.mjs';
import { buildRegistryV4FromDiscovery } from './registry-v4-source.mjs';
import {
  loadRegistryV4SourceConfig,
  requiredRegistryPackageFailures,
} from './registry-v4-config.mjs';
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
const DISCOVERY_FILE = resolve(CATALOG_DIR, 'plugins.json');
const REGISTRY_V4_FILE = resolve(CATALOG_DIR, 'registry-v4.json');
const CANDIDATE_FILE = resolve(CATALOG_DIR, 'registry-candidates-v1.json');
const SOURCE_CONFIG_FILE = resolve(ROOT, 'config/registry-v4-sources.json');

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function readOptionalJson(file) {
  if (!(await exists(file))) return null;
  return JSON.parse(await readFile(file, 'utf8'));
}

async function buildCanonicalRegistry() {
  let registry = await readOptionalJson(REGISTRY_V4_FILE);
  let candidates = await readOptionalJson(CANDIDATE_FILE);
  if (registry) {
    registry = validateRegistryV4(registry);
  } else {
    const [discovery, sourceConfig] = await Promise.all([
      readOptionalJson(DISCOVERY_FILE),
      loadRegistryV4SourceConfig(SOURCE_CONFIG_FILE),
    ]);
    if (!discovery?.plugins?.length) throw new Error('Registry V4 is missing and discovery candidate input is empty; run npm run sync:registry');
    const built = await buildRegistryV4FromDiscovery(discovery, {
      token: process.env.GITHUB_TOKEN || '',
      generated_at: process.env.DSH_GENERATED_AT || new Date().toISOString(),
      explicitSources: sourceConfig.sources,
    });
    const requiredFailures = requiredRegistryPackageFailures(built, sourceConfig.required_packages);
    if (requiredFailures.length) {
      throw new Error(`Registry V4 build requires immutable Descriptor V2 releases: ${requiredFailures.map((item) => `${item.type}:${item.id} (${item.reason})`).join(', ')}`);
    }
    registry = validateRegistryV4(built.registry);
    candidates = built.candidates;
    await writeFile(REGISTRY_V4_FILE, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
    await writeFile(CANDIDATE_FILE, `${JSON.stringify(candidates, null, 2)}\n`, 'utf8');
  }
  await writeFile(resolve(TARGET_DIR, 'registry-v4.json'), `${JSON.stringify(registry)}\n`, 'utf8');
  return { registry, candidates };
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
    resolve(TARGET_DIR, 'registry-candidates-v1.json'),
    resolve(TARGET_DIR, 'catalog-v3'),
    resolve(ROOT, 'site/public/install'),
  ]) await rm(path, { recursive: true, force: true });
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
  const { registry, candidates } = await buildCanonicalRegistry();

  const searchIndex = buildSearchIndexV3(registry, candidates);
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

  console.log(`Canonical assets ready: Registry V4 ${registry.metadata.package_count} installable packages, Search Index V3 ${searchIndex.count} discovery items (${searchIndex.discovery_only_count} discovery-only), Distribution V2 ${distribution.package_count} shards`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
