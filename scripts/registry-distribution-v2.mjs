#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

function sha(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const text = `${JSON.stringify(value)}\n`;
  await writeFile(path, text, 'utf8');
  return { bytes: Buffer.byteLength(text), hash: sha(text) };
}

export async function writeRegistryDistributionV2(registry, outputDir) {
  if (!registry || registry.schema_version !== 4 || !Array.isArray(registry.packages)) throw new Error('Distribution V2 requires Registry V4');
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const packageMap = {};
  let totalBytes = 0;
  for (const pkg of registry.packages) {
    const key = `${pkg.type}:${pkg.id}`;
    const digest = sha(key);
    const relative = `packages/${digest.slice(0, 2)}/${digest}.json`;
    const written = await writeJson(resolve(outputDir, relative), pkg);
    packageMap[key] = { path: relative, hash: written.hash, bytes: written.bytes };
    totalBytes += written.bytes;
  }

  const publisherMap = {};
  for (const publisher of registry.publishers || []) {
    const digest = sha(String(publisher.id));
    const relative = `publishers/${digest.slice(0, 2)}/${digest}.json`;
    const packages = registry.packages.filter((pkg) => pkg.publisher_id === publisher.id).map((pkg) => `${pkg.type}:${pkg.id}`);
    const written = await writeJson(resolve(outputDir, relative), { ...publisher, packages });
    publisherMap[publisher.id] = { path: relative, hash: written.hash, bytes: written.bytes };
    totalBytes += written.bytes;
  }

  const advisoryMap = {};
  for (const advisory of registry.advisories || []) {
    const digest = sha(String(advisory.id));
    const relative = `advisories/${digest.slice(0, 2)}/${digest}.json`;
    const written = await writeJson(resolve(outputDir, relative), advisory);
    advisoryMap[advisory.id] = { path: relative, hash: written.hash, bytes: written.bytes };
    totalBytes += written.bytes;
  }

  const index = {
    distribution_version: 2,
    registry_schema_version: 4,
    registry_revision: registry.revision,
    generated_at: registry.generated_at,
    packages: packageMap,
    publishers: publisherMap,
    advisories: advisoryMap,
    metadata: {
      package_count: Object.keys(packageMap).length,
      publisher_count: Object.keys(publisherMap).length,
      advisory_count: Object.keys(advisoryMap).length,
    },
  };
  const writtenIndex = await writeJson(resolve(outputDir, 'index.json'), index);
  totalBytes += writtenIndex.bytes;
  return { ...index.metadata, bytes: totalBytes, index_hash: writtenIndex.hash, registry_revision: registry.revision };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.cwd();
  const registry = JSON.parse(await readFile(resolve(root, process.argv[2] || 'catalog/registry-v4.json'), 'utf8'));
  const result = await writeRegistryDistributionV2(registry, resolve(root, process.argv[3] || 'site/public/catalog/registry-v4'));
  console.log(`Registry Distribution V2: ${result.package_count} packages / ${result.publisher_count} publishers / ${result.advisory_count} advisories / ${result.bytes} bytes`);
}
