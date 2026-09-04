#!/usr/bin/env node
import { access, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { validateRegistryV4 } from '../packages/registry-core/index.mjs';

const ROOT = process.cwd();
const MAX_PUBLIC_REGISTRY_BYTES = 24 * 1024 * 1024;
const REQUIRED = [
  'site/dist/index.html',
  'site/dist/openapi.json',
  'site/dist/.well-known/dsh-marketplace.json',
  'site/dist/catalog/registry-v4.json',
  'site/dist/catalog/registry-v4/index.json',
  'site/dist/catalog/search-index-v3.json',
];
const FORBIDDEN = [
  'site/dist/catalog/registry-v3.json',
  'site/dist/catalog/search-index-v2.json',
  'site/dist/catalog/distribution-v1',
  'site/dist/catalog/plugins.json',
  'site/dist/catalog/catalog-v3',
];

async function exists(path) { try { await access(resolve(ROOT, path)); return true; } catch { return false; } }
async function json(path) { return JSON.parse(await readFile(resolve(ROOT, path), 'utf8')); }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }

for (const path of REQUIRED) if (!await exists(path)) throw new Error(`required deploy artifact is missing: ${path}`);
for (const path of FORBIDDEN) if (await exists(path)) throw new Error(`legacy deploy artifact must not be published: ${path}`);

const sourceRegistry = validateRegistryV4(await json('catalog/registry-v4.json'));
const builtRegistry = validateRegistryV4(await json('site/dist/catalog/registry-v4.json'));
if (sourceRegistry.revision !== builtRegistry.revision) throw new Error(`Registry V4 revision mismatch: source=${sourceRegistry.revision} build=${builtRegistry.revision}`);

const registrySize = (await stat(resolve(ROOT, 'site/dist/catalog/registry-v4.json'))).size;
if (registrySize > MAX_PUBLIC_REGISTRY_BYTES) throw new Error(`registry-v4.json exceeds the 24 MiB public single-file budget: ${registrySize}`);

const distribution = await json('site/dist/catalog/registry-v4/index.json');
if (distribution.distribution_version !== 2 || distribution.registry_schema_version !== 4) throw new Error('invalid Distribution V2 index');
if (distribution.registry_revision !== builtRegistry.revision) throw new Error('Distribution V2 revision differs from Registry V4');
if (Number(distribution.metadata?.package_count ?? Object.keys(distribution.packages || {}).length) !== builtRegistry.packages.length) throw new Error('Distribution V2 package count differs from Registry V4');

const search = await json('site/dist/catalog/search-index-v3.json');
if (search.version !== 3 || search.registry_schema_version !== 4) throw new Error('invalid Search Index V3');
if (search.registry_revision !== builtRegistry.revision) throw new Error('Search Index V3 revision differs from Registry V4');
if (search.count !== builtRegistry.packages.length) throw new Error(`Search Index V3 count differs from Registry V4: ${search.count} vs ${builtRegistry.packages.length}`);

const discovery = await json('site/dist/.well-known/dsh-marketplace.json');
if (discovery.schema !== 'dsh-marketplace-discovery.v2' || discovery.protocol?.version !== 2 || discovery.api?.version !== 'v2' || discovery.registry?.version !== 4) throw new Error('platform discovery contract is not Protocol V2 / API V2 / Registry V4');
if (discovery.installation?.remote_mutation !== false || discovery.installation?.local_runtime_is_write_authority !== true || discovery.installation?.deep_link_registry_override !== false || discovery.installation?.auto_restart !== false) throw new Error('platform discovery violates local-runtime authority policy');

const openapi = await json('site/dist/openapi.json');
if (openapi.info?.title !== 'DSH Go API V2' || Object.keys(openapi.paths || {}).some((path) => !path.startsWith('/api/v2'))) throw new Error('OpenAPI contains a non-V2 API surface');

const summary = {
  protocol_version: 2,
  api_version: 'v2',
  registry_schema: 4,
  registry_revision: builtRegistry.revision,
  distribution_version: 2,
  search_index_version: 3,
  packages: builtRegistry.packages.length,
  releases: builtRegistry.packages.reduce((sum, item) => sum + item.releases.length, 0),
  registry_bytes: registrySize,
  registry_sha256: hash(await readFile(resolve(ROOT, 'site/dist/catalog/registry-v4.json'))),
};
console.log(JSON.stringify(summary, null, 2));
