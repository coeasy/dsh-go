#!/usr/bin/env node
/** Provider Adapter assets are copied first; the stable legacy asset pipeline then runs unchanged. */
import { access, cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = resolve(ROOT, 'site/public/catalog');

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
await import('./copy-assets-core.mjs');
