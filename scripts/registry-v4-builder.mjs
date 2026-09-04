#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildRegistryV4FromDiscovery } from './registry-v4-source.mjs';
import {
  loadRegistryV4SourceConfig,
  requiredRegistryPackageFailures,
} from './registry-v4-config.mjs';
import { validateRegistryV4 } from '../packages/registry-core/index.mjs';

const root = process.cwd();
const sourcePath = resolve(root, process.env.DSH_DISCOVERY_SOURCE || 'catalog/plugins.json');
const outputPath = resolve(root, process.env.DSH_REGISTRY_V4_OUTPUT || 'catalog/registry-v4.json');
const candidatePath = resolve(root, process.env.DSH_REGISTRY_CANDIDATES_OUTPUT || 'catalog/registry-candidates-v1.json');
const sourceConfigPath = resolve(root, process.env.DSH_REGISTRY_SOURCE_CONFIG || 'config/registry-v4-sources.json');

const [source, sourceConfig] = await Promise.all([
  JSON.parse(await readFile(sourcePath, 'utf8')),
  loadRegistryV4SourceConfig(sourceConfigPath),
]);
if (!Array.isArray(source.plugins) || !source.plugins.length) throw new Error(`discovery source contains no records: ${sourcePath}`);

const { registry, candidates, stats } = await buildRegistryV4FromDiscovery(source, {
  token: process.env.GITHUB_TOKEN || '',
  generated_at: process.env.DSH_GENERATED_AT || new Date().toISOString(),
  explicitSources: sourceConfig.sources,
});
const requiredFailures = requiredRegistryPackageFailures({ registry, candidates, stats }, sourceConfig.required_packages);
if (requiredFailures.length) {
  throw new Error(`Registry V4 required Package Descriptor V2 releases are not ready: ${requiredFailures.map((item) => `${item.type}:${item.id} (${item.reason})`).join(', ')}`);
}
validateRegistryV4(registry);
await writeFile(outputPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
await writeFile(candidatePath, `${JSON.stringify(candidates, null, 2)}\n`, 'utf8');
console.log(`Registry V4: ${registry.metadata.package_count} installable packages / ${registry.metadata.release_count} releases / quarantined=${stats.quarantined} rejected=${stats.rejected} / revision ${registry.revision}`);
