#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildRegistryV4FromDiscovery } from './registry-v4-source.mjs';
import { validateRegistryV4 } from '../packages/registry-core/index.mjs';
import { buildSearchIndexV3 } from './build-search-index-v3.mjs';
import { writeRegistryDistributionV2 } from './registry-distribution-v2.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = resolve(ROOT, 'catalog');
const PUBLIC = resolve(ROOT, 'site/public/catalog');
const REGISTRY_FILE = resolve(CATALOG, 'registry-v4.json');
const CANDIDATE_FILE = resolve(CATALOG, 'registry-candidates-v1.json');
const SEARCH_FILE = resolve(PUBLIC, 'search-index-v3.json');
const DISTRIBUTION_DIR = resolve(PUBLIC, 'registry-v4');

function arg(name) { return process.argv.includes(name); }
function runDiscovery(mode) {
  const script = resolve(ROOT, 'scripts/discovery-sync.mjs');
  const args = [script];
  if (mode === 'incremental') args.push('--incremental');
  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env: process.env });
  if (result.status !== 0) throw new Error(`discovery collection failed with status ${result.status}`);
}

async function loadJson(file) { return JSON.parse(await readFile(file, 'utf8')); }

async function main() {
  const mode = arg('--incremental') ? 'incremental' : arg('--registry-only') ? 'registry-only' : 'full';
  if (mode !== 'registry-only') runDiscovery(mode);

  const discovery = await loadJson(resolve(CATALOG, 'plugins.json'));
  const built = await buildRegistryV4FromDiscovery(discovery, {
    token: process.env.GITHUB_TOKEN || '',
    generated_at: new Date().toISOString(),
  });
  const registry = validateRegistryV4(built.registry);
  await mkdir(CATALOG, { recursive: true });
  await mkdir(PUBLIC, { recursive: true });
  await writeFile(REGISTRY_FILE, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  await writeFile(CANDIDATE_FILE, `${JSON.stringify(built.candidates, null, 2)}\n`, 'utf8');
  await writeFile(resolve(PUBLIC, 'registry-v4.json'), `${JSON.stringify(registry)}\n`, 'utf8');
  const search = buildSearchIndexV3(registry, built.candidates);
  await writeFile(SEARCH_FILE, `${JSON.stringify(search)}\n`, 'utf8');
  const distribution = await writeRegistryDistributionV2(registry, DISTRIBUTION_DIR);
  console.log(JSON.stringify({
    mode,
    registry_version: registry.schema_version,
    registry_revision: registry.revision,
    installable_packages: registry.metadata.package_count,
    candidates: built.candidates.counts,
    search_items: search.count,
    distribution_shards: distribution.package_count,
  }, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
