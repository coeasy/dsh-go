#!/usr/bin/env node
import { access, readFile, readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import {
  validatePackageManifest,
  PACKAGE_MANIFEST_VERSION,
  PACKAGE_RELEASE_DESCRIPTOR_VERSION,
} from '../packages/protocol-core/manifest.mjs';
import {
  DSH_API_VERSION,
  DSH_DISTRIBUTION_VERSION,
  DSH_PACKAGE_MANIFEST_VERSION,
  DSH_PLATFORM_VERSION,
  DSH_PROTOCOL_VERSION,
  DSH_REGISTRY_SCHEMA_VERSION,
  DSH_REGISTRY_VERSION,
  DSH_RUNTIME_STATE_VERSION,
  DSH_RUNTIME_VERSION,
  DSH_SEARCH_INDEX_VERSION,
} from '../runtime/version.mjs';

const EXPECTED_PRODUCT_VERSION = '0.1.0';
const errors = [];

async function json(path) { return JSON.parse(await readFile(resolve(path), 'utf8')); }
function expect(label, actual, expected) { if (actual !== expected) errors.push(`${label}: expected ${expected}, got ${actual}`); }
async function mustExist(path) { try { await access(resolve(path)); } catch { errors.push(`${path} is required`); } }
async function mustNotExist(path) { try { await access(resolve(path)); errors.push(`${path} is a removed legacy surface`); } catch (error) { if (error?.code !== 'ENOENT') throw error; } }

const rootPackage = await json('package.json');
const rootLock = await json('package-lock.json');
const sitePackage = await json('site/package.json');
const siteLock = await json('site/package-lock.json');
expect('package.json version', rootPackage.version, EXPECTED_PRODUCT_VERSION);
expect('package-lock.json version', rootLock.version, EXPECTED_PRODUCT_VERSION);
expect('package-lock root version', rootLock.packages?.['']?.version, EXPECTED_PRODUCT_VERSION);
expect('site/package.json version', sitePackage.version, EXPECTED_PRODUCT_VERSION);
expect('site/package-lock.json version', siteLock.version, EXPECTED_PRODUCT_VERSION);
expect('site/package-lock root version', siteLock.packages?.['']?.version, EXPECTED_PRODUCT_VERSION);
expect('platform version', DSH_PLATFORM_VERSION, EXPECTED_PRODUCT_VERSION);
expect('runtime version', DSH_RUNTIME_VERSION, EXPECTED_PRODUCT_VERSION);
expect('API version', DSH_API_VERSION, 'v2');
expect('protocol version', DSH_PROTOCOL_VERSION, 2);
expect('Registry version', DSH_REGISTRY_VERSION, 4);
expect('Registry schema version', DSH_REGISTRY_SCHEMA_VERSION, 4);
expect('Distribution version', DSH_DISTRIBUTION_VERSION, 2);
expect('Search Index version', DSH_SEARCH_INDEX_VERSION, 3);
expect('Runtime State version', DSH_RUNTIME_STATE_VERSION, 4);
expect('Package Manifest version', DSH_PACKAGE_MANIFEST_VERSION, PACKAGE_MANIFEST_VERSION);
expect('Package Release Descriptor version', PACKAGE_RELEASE_DESCRIPTOR_VERSION, 2);

for (const path of [
  'packages/protocol-core/index.mjs',
  'packages/protocol-core/manifest.mjs',
  'packages/registry-core/index.mjs',
  'packages/resolver/index.mjs',
  'schemas/dsh-package-v2.schema.json',
  'schemas/dsh-package-release-v2.schema.json',
  'config/registry-v4-sources.json',
  'scripts/sync-v4.mjs',
  'scripts/validate-registry-v4.mjs',
  'scripts/registry-distribution-v2.mjs',
  'scripts/build-search-index-v3.mjs',
  'functions/api/v2/index.ts',
  'functions/api/v2/capabilities.ts',
  'functions/api/v2/health.ts',
  'functions/api/v2/search.ts',
  'functions/api/v2/resolve.ts',
  'functions/api/v2/install-plan.ts',
  'functions/api/v2/mcp.ts',
  'site/src/components/MarketplaceV2.astro',
  'site/src/i18n/messages.ts',
  'site/src/pages/package/[type]/[...id].astro',
  'schemas/dsh-marketplace-discovery-v2.schema.json',
]) await mustExist(path);

for (const path of [
  'functions/api/v1',
  'site/src/pages/plugin',
  'site/src/pages/ecosystem/[id].astro',
]) await mustNotExist(path);

const manifestSchema = await json('schemas/dsh-package-v2.schema.json');
expect('Manifest V2 JSON Schema version marker', manifestSchema.properties?.manifest_version?.const, PACKAGE_MANIFEST_VERSION);
if (manifestSchema.properties?.schema_version) errors.push('Manifest V2 JSON Schema must not expose legacy schema_version');

const releaseSchema = await json('schemas/dsh-package-release-v2.schema.json');
expect('Release Descriptor V2 schema marker', releaseSchema.properties?.release_version?.const, PACKAGE_RELEASE_DESCRIPTOR_VERSION);
expect('Release Descriptor protocol marker', releaseSchema.properties?.protocol_version?.const, 2);
expect('Release Descriptor Manifest marker', releaseSchema.properties?.manifest_version?.const, PACKAGE_MANIFEST_VERSION);
if (!releaseSchema.required?.includes('commit') || !releaseSchema.required?.includes('artifact') || !releaseSchema.required?.includes('published_at')) {
  errors.push('Release Descriptor V2 schema must bind commit, artifact and published_at');
}

const sourceConfig = await json('config/registry-v4-sources.json');
expect('Registry V4 source config schema', sourceConfig.schema_version, 1);
if (!Array.isArray(sourceConfig.sources)) errors.push('Registry V4 source config must contain sources[]');
for (const [index, source] of (sourceConfig.sources || []).entries()) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(source?.repository || ''))) errors.push(`Registry source ${index} has invalid repository`);
  if (!source?.package_path || String(source.package_path).includes('..') || String(source.package_path).startsWith('/')) errors.push(`Registry source ${index} must declare a safe package_path`);
}

async function collectPackageManifests(root, depth = 0) {
  if (depth > 5) return [];
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return []; }
  const files = [];
  for (const entry of entries) {
    if (['node_modules', '.git', 'dist', 'build', '.astro'].includes(entry.name)) continue;
    const child = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await collectPackageManifests(child, depth + 1));
    else if (entry.name === 'dsh-package.json') files.push(child);
  }
  return files;
}

const packageManifests = [resolve('dsh-package.json'), ...await collectPackageManifests(resolve('packages'))];
if (!packageManifests.length) errors.push('at least one canonical dsh-package.json is required');
for (const file of packageManifests) {
  try {
    const manifest = JSON.parse(await readFile(file, 'utf8'));
    if ('schema_version' in manifest) errors.push(`${file}: legacy schema_version is forbidden in Manifest V2`);
    expect(`${file} manifest_version`, manifest.manifest_version, PACKAGE_MANIFEST_VERSION);
    validatePackageManifest(manifest);
  } catch (error) {
    errors.push(`${file}: invalid Manifest V2 (${error.message})`);
  }
}

const rootManifest = await json('dsh-package.json');
const marketplaceManifest = await json('packages/dsh-go-marketplace/dsh-package.json');
for (const key of ['id', 'type', 'version', 'channel']) {
  expect(`root/nested Marketplace ${key}`, rootManifest[key], marketplaceManifest[key]);
}
expect('root Marketplace release package path', rootManifest.release?.package_path, 'packages/dsh-go-marketplace');
expect('nested Marketplace release package path', marketplaceManifest.release?.package_path, 'packages/dsh-go-marketplace');
const desktopManifest = await json('packages/dsh-go-marketplace-plugin/dsh-package.json');
expect('desktop Marketplace release package path', desktopManifest.release?.package_path, 'packages/dsh-go-marketplace-plugin');

const discovery = await json('site/public/.well-known/dsh-marketplace.json');
expect('discovery schema', discovery.schema, 'dsh-marketplace-discovery.v2');
expect('discovery service id', discovery.service?.id, 'dsh-go');
expect('discovery service mode', discovery.service?.mode, 'read-only-discovery');
expect('discovery protocol', discovery.protocol?.version, 2);
expect('discovery API', discovery.api?.version, 'v2');
expect('discovery Registry', discovery.registry?.version, 4);
expect('discovery Distribution', discovery.registry?.distribution?.version, 2);
expect('discovery Search Index', discovery.registry?.search_index?.version, 3);
expect('remote mutation', discovery.installation?.remote_mutation, false);
expect('local write authority', discovery.installation?.local_runtime_is_write_authority, true);
expect('deep-link Registry override', discovery.installation?.deep_link_registry_override, false);
expect('automatic restart', discovery.installation?.auto_restart, false);

const openapi = await json('site/public/openapi.json');
expect('OpenAPI title', openapi.info?.title, 'DSH Go API V2');
if (!Object.keys(openapi.paths || {}).every((path) => path.startsWith('/api/v2'))) errors.push('OpenAPI contains non-V2 API paths');

async function filesUnder(root) {
  const result = [];
  async function walk(path) {
    let entries;
    try { entries = await readdir(path, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (['.mjs', '.js', '.ts', '.astro', '.json', '.md'].includes(extname(entry.name))) result.push(child);
    }
  }
  await walk(root);
  return result;
}

const activeFiles = [
  ...(await filesUnder(resolve('runtime'))),
  ...(await filesUnder(resolve('functions'))),
  ...(await filesUnder(resolve('site/src'))),
  resolve('site/public/openapi.json'),
  resolve('site/public/.well-known/dsh-marketplace.json'),
];
const forbidden = [
  ['/api/v1', 'legacy API V1 route'],
  ['dsh://install?', 'legacy deep-link query'],
  ['dsh://plugin/', 'legacy plugin deep-link'],
  ['dsh plugin add', 'legacy plugin CLI'],
  ['/catalog/registry-v3.json', 'legacy public Registry V3 path'],
  ['/catalog/search-index-v2.json', 'legacy Search Index V2 path'],
  ['/catalog/distribution-v1', 'legacy Distribution V1 path'],
];
for (const file of activeFiles) {
  const text = await readFile(file, 'utf8');
  for (const [needle, label] of forbidden) if (text.includes(needle)) errors.push(`${file}: contains ${label} (${needle})`);
}

const runtimeState = await readFile(resolve('runtime/registry.mjs'), 'utf8');
if (!runtimeState.includes('RUNTIME_STATE_SCHEMA_VERSION = 4')) errors.push('Runtime State V4 is not canonical');
if (!runtimeState.includes("if ('plugins' in data) throw")) errors.push('Runtime State V4 must reject the legacy plugins mirror');
const hostBridge = await readFile(resolve('runtime/host-bridge.mjs'), 'utf8');
if (!hostBridge.includes("url.hostname !== 'package' || url.pathname !== '/install'")) errors.push('Host bridge must accept only canonical dsh://package/install links');
if (!hostBridge.includes("url.searchParams.has('registry')")) errors.push('Host bridge must reject Registry overrides from remote deep links');

if (errors.length) {
  console.error('DSH canonical architecture contract failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`DSH canonical contract passed: Protocol V2 / Manifest V2 (${packageManifests.length}) / Release Descriptor V2 / Registry V4 / Distribution V2 / Search V3 / Runtime State V4 / API V2.`);
