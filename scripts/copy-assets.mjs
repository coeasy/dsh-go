#!/usr/bin/env node
/** Provider Adapter assets are copied first; the stable legacy asset pipeline then runs unchanged. */
import { access, cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = resolve(ROOT, 'site/public/catalog');
const DISCOVERY_SCHEMA_TARGET = resolve(ROOT, 'site/public/schemas');

async function copyIfPresent(source, name) {
  try {
    await access(source);
  } catch {
    return;
  }
  await mkdir(TARGET, { recursive: true });
  await cp(source, resolve(TARGET, name));
  console.log(`Copied ${name} -> site/public/catalog/`);
}

await copyIfPresent(resolve(ROOT, 'catalog/provider-adapters.json'), 'provider-adapters.json');
await copyIfPresent(resolve(ROOT, 'schemas/provider-adapter.schema.json'), 'provider-adapter.schema.json');
await copyIfPresent(resolve(ROOT, 'schemas/provider-adapter-registry.schema.json'), 'provider-adapter-registry.schema.json');

async function copyDiscoverySchema() {
  const source = resolve(ROOT, 'schemas/dsh-marketplace-discovery.schema.json');
  try { await access(source); } catch { return; }
  await mkdir(DISCOVERY_SCHEMA_TARGET, { recursive: true });
  await cp(source, resolve(DISCOVERY_SCHEMA_TARGET, 'dsh-marketplace-discovery.schema.json'));
  console.log('Copied dsh-marketplace-discovery.schema.json -> site/public/schemas/');
}

await copyDiscoverySchema();
await import('./copy-assets-core.mjs');
