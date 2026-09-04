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
const SOURCE_FILE = resolve(ROOT, 'config/registry-v4-sources.json');
const PUBLICATION_STATUS_FILE = resolve(ROOT, '.dsh-registry-publication.json');

function arg(name) { return process.argv.includes(name); }
function runDiscovery(mode) {
  const script = resolve(ROOT, 'scripts/discovery-sync.mjs');
  const args = [script];
  if (mode === 'incremental') args.push('--incremental');
  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env: process.env });
  if (result.status !== 0) throw new Error(`discovery collection failed with status ${result.status}`);
}

async function loadJson(file) { return JSON.parse(await readFile(file, 'utf8')); }

async function loadRegistrySourceConfig() {
  const config = await loadJson(SOURCE_FILE);
  if (config?.schema_version !== 1 || !Array.isArray(config.sources) || !Array.isArray(config.required_packages)) {
    throw new Error('config/registry-v4-sources.json must use schema_version=1 with sources[] and required_packages[]');
  }
  return config;
}

function requiredPackageFailures(built, requiredPackages) {
  const candidates = Array.isArray(built?.candidates?.candidates) ? built.candidates.candidates : [];
  return requiredPackages.map((required) => {
    const repository = String(required.repository || '').toLowerCase();
    const packagePath = String(required.package_path || '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
    const type = String(required.type || '').toLowerCase();
    const id = String(required.id || '').toLowerCase();
    const accepted = candidates.find((candidate) => candidate.status === 'accepted'
      && String(candidate.repo || '').toLowerCase() === repository
      && String(candidate.package_path || '') === packagePath
      && String(candidate.type || '').toLowerCase() === type
      && String(candidate.id || '').toLowerCase() === id);
    if (accepted) return null;
    const observed = candidates.find((candidate) => String(candidate.repo || '').toLowerCase() === repository
      && String(candidate.package_path || '') === packagePath
      && String(candidate.type || '').toLowerCase() === type
      && String(candidate.id || '').toLowerCase() === id);
    return {
      repository,
      package_path: packagePath,
      type,
      id,
      status: observed?.status || 'missing',
      reason: observed?.reason || 'required-package-not-observed',
    };
  }).filter(Boolean);
}

async function writePublicationStatus(payload) {
  await writeFile(PUBLICATION_STATUS_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main() {
  const mode = arg('--incremental') ? 'incremental' : arg('--registry-only') ? 'registry-only' : 'full';
  if (mode !== 'registry-only') runDiscovery(mode);

  const [discovery, sourceConfig] = await Promise.all([
    loadJson(resolve(CATALOG, 'plugins.json')),
    loadRegistrySourceConfig(),
  ]);
  const built = await buildRegistryV4FromDiscovery(discovery, {
    token: process.env.GITHUB_TOKEN || '',
    generated_at: new Date().toISOString(),
    explicitSources: sourceConfig.sources,
  });

  const requiredFailures = requiredPackageFailures(built, sourceConfig.required_packages);
  if (requiredFailures.length) {
    const status = {
      schema_version: 1,
      ready: false,
      mode,
      reason: 'required-release-descriptor-v2-not-ready',
      required_failures: requiredFailures,
      registry_revision: built.registry.revision,
    };
    await writePublicationStatus(status);
    const message = `Registry V4 publication blocked until required Release Descriptor V2 packages are accepted: ${requiredFailures.map((item) => `${item.type}:${item.id} (${item.reason})`).join(', ')}`;
    if (process.env.DSH_DEFER_INCOMPLETE_REQUIRED_PACKAGES === '1') {
      console.log(JSON.stringify(status, null, 2));
      console.log(message);
      return;
    }
    throw new Error(message);
  }

  const registry = validateRegistryV4(built.registry);
  await mkdir(CATALOG, { recursive: true });
  await mkdir(PUBLIC, { recursive: true });
  await writeFile(REGISTRY_FILE, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  await writeFile(CANDIDATE_FILE, `${JSON.stringify(built.candidates, null, 2)}\n`, 'utf8');
  await writeFile(resolve(PUBLIC, 'registry-v4.json'), `${JSON.stringify(registry)}\n`, 'utf8');
  const search = buildSearchIndexV3(registry, built.candidates);
  await writeFile(SEARCH_FILE, `${JSON.stringify(search)}\n`, 'utf8');
  const distribution = await writeRegistryDistributionV2(registry, DISTRIBUTION_DIR);
  await writePublicationStatus({
    schema_version: 1,
    ready: true,
    mode,
    registry_revision: registry.revision,
    installable_packages: registry.metadata.package_count,
  });
  console.log(JSON.stringify({
    mode,
    registry_version: registry.schema_version,
    registry_revision: registry.revision,
    installable_packages: registry.metadata.package_count,
    explicit_sources: registry.metadata.explicit_source_count,
    candidates: built.candidates.counts,
    search_items: search.count,
    distribution_shards: distribution.package_count,
  }, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
