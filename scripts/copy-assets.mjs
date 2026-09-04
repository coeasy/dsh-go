#!/usr/bin/env node
/** Canonical public-asset pipeline. Registry V4 assets are built by copy-assets-core.mjs. */
import { access, cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = resolve(ROOT, 'site/public/catalog');
const SCHEMA_TARGET = resolve(ROOT, 'site/public/schemas');

async function copyIfPresent(source, targetDir, name) {
  try { await access(source); } catch { return false; }
  await mkdir(targetDir, { recursive: true });
  await cp(source, resolve(targetDir, name));
  console.log(`Copied ${name}`);
  return true;
}

await copyIfPresent(resolve(ROOT, 'catalog/provider-adapters.json'), TARGET, 'provider-adapters.json');
await copyIfPresent(resolve(ROOT, 'schemas/provider-adapter.schema.json'), TARGET, 'provider-adapter.schema.json');
await copyIfPresent(resolve(ROOT, 'schemas/provider-adapter-registry.schema.json'), TARGET, 'provider-adapter-registry.schema.json');

await mkdir(SCHEMA_TARGET, { recursive: true });
await rm(resolve(SCHEMA_TARGET, 'dsh-marketplace-discovery.schema.json'), { force: true });
const copied = await copyIfPresent(
  resolve(ROOT, 'schemas/dsh-marketplace-discovery-v2.schema.json'),
  SCHEMA_TARGET,
  'dsh-marketplace-discovery-v2.schema.json',
);
if (!copied) throw new Error('canonical discovery V2 schema is missing');

await import('./copy-assets-core.mjs');
