#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './checksum.mjs';
import { validateCatalog } from './validate.mjs';
import { validateRegistry } from './validate-registry-v3.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MAX_PUBLIC_REGISTRY_BYTES = 24 * 1024 * 1024;
const paths = {
  catalog: resolve(ROOT, 'catalog/plugins.json'),
  registry: resolve(ROOT, 'catalog/registry-v3.json'),
  meta: resolve(ROOT, 'catalog/meta.json'),
  schema: resolve(ROOT, 'catalog/schema-v3.json'),
};
async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }

export async function runDeployGate() {
  const [catalog, registry, meta, schemaRaw, registryStat] = await Promise.all([
    readJson(paths.catalog),
    readJson(paths.registry),
    readJson(paths.meta),
    readFile(paths.schema, 'utf8'),
    stat(paths.registry),
  ]);
  const errors = [];
  const warnings = [];
  const legacy = validateCatalog(catalog);
  const v3 = validateRegistry(registry);
  errors.push(...legacy.errors.map((e) => `legacy: ${e}`), ...v3.errors.map((e) => `registry: ${e}`));
  warnings.push(...legacy.warns.map((w) => `legacy: ${w}`), ...v3.warns.map((w) => `registry: ${w}`));

  if (registryStat.size > MAX_PUBLIC_REGISTRY_BYTES) {
    errors.push(`registry-v3.json exceeds the 24 MiB public single-file budget: ${registryStat.size} bytes`);
  }
  if (meta.registry_version !== 3) errors.push('meta.registry_version must be 3');
  if (!meta.pipeline?.verified) errors.push('meta.pipeline.verified must be true');
  if (!meta.pipeline?.frozen) errors.push('meta.pipeline.frozen must be true');
  if (meta.pipeline?.source_catalog_etag !== catalog.meta?.etag) errors.push('pipeline source catalog etag mismatch');
  if (registry.generated?.source_catalog_etag !== catalog.meta?.etag) errors.push('registry source catalog etag mismatch');
  if (meta.registry?.content_hash !== registry.generated?.content_hash) errors.push('meta/registry content hash mismatch');
  if (meta.registry?.count !== registry.plugins?.length) errors.push('meta.registry.count mismatch');
  if (meta.registry?.schema_hash !== sha256(schemaRaw)) errors.push('schema hash mismatch');
  return { errors, warnings, catalog, registry, meta, registryBytes: registryStat.size };
}

async function main() {
  const result = await runDeployGate();
  result.warnings.slice(0, 50).forEach((warning) => console.warn('[WARN]', warning));
  if (result.errors.length) {
    result.errors.forEach((error) => console.error('[DEPLOY BLOCK]', error));
    process.exit(1);
  }
  console.log(`Deploy Gate V3 passed: legacy=${result.catalog.plugins.length}, registry=${result.registry.plugins.length}, registry_bytes=${result.registryBytes}, hash=${result.registry.generated.content_hash}`);
}
main().catch((error) => { console.error('[DEPLOY BLOCK]', error.stack || error.message); process.exit(1); });
