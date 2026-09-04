#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildRegistryV4 } from '../packages/registry-core/index.mjs';

const root = process.cwd();
const sourcePath = resolve(root, process.env.DSH_REGISTRY_SOURCE || 'catalog/registry-v3.json');
const outputPath = resolve(root, process.env.DSH_REGISTRY_V4_OUTPUT || 'catalog/registry-v4.json');

const source = JSON.parse(await readFile(sourcePath, 'utf8'));
const records = Array.isArray(source.plugins) ? source.plugins : Array.isArray(source.packages) ? source.packages : [];
if (!records.length) throw new Error(`registry source contains no package records: ${sourcePath}`);

const registry = buildRegistryV4(records, {
  generated_at: process.env.DSH_GENERATED_AT || source.generated?.at || new Date().toISOString(),
  source: 'dsh-go-registry-v4-builder',
});
await writeFile(outputPath, `${JSON.stringify(registry)}\n`, 'utf8');
console.log(`Registry V4: ${registry.metadata.package_count} packages / ${registry.metadata.release_count} releases / revision ${registry.revision}`);
