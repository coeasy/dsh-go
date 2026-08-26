#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

function tokens(value) {
  return [...new Set(String(value || '').toLowerCase().split(/[^a-z0-9_.-]+/).filter((token) => token.length > 1))].slice(0, 80);
}

export function buildSearchIndex(registry) {
  const items = (registry.plugins || []).map((item) => ({
    id: item.id,
    type: item.runtime?.type || 'plugin',
    version: item.version,
    name: item.metadata?.name || item.id,
    description: item.metadata?.description || '',
    category: item.metadata?.category || 'other',
    verified: item.metadata?.verified === true,
    stars: Number(item.metadata?.stars || 0),
    capabilities: item.capabilities || [],
    permissions: item.permissions || [],
    repo: item.source?.repo || '',
    tokens: tokens([item.id, item.metadata?.name, item.metadata?.description, item.metadata?.category, ...(item.capabilities || []), ...(item.provides || []), item.source?.repo].filter(Boolean).join(' ')),
  }));
  const hash = createHash('sha256').update(JSON.stringify(items)).digest('hex');
  return { version: 2, generated_at: registry.generated?.at || new Date().toISOString(), registry_hash: registry.generated?.content_hash || '', hash, count: items.length, items };
}

async function main() {
  const source = resolve(process.argv[2] || 'catalog/registry-v3.json');
  const target = resolve(process.argv[3] || 'catalog/search-index-v2.json');
  const registry = JSON.parse(await readFile(source, 'utf8'));
  await writeFile(target, `${JSON.stringify(buildSearchIndex(registry))}\n`, 'utf8');
  console.log(`Search Index V2 written: ${target}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
}
