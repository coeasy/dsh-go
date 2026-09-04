#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareVersion, packageKey } from '../packages/protocol-core/index.mjs';

function tokens(value) {
  return [...new Set(String(value || '').toLocaleLowerCase().split(/[^\p{L}\p{N}_.-]+/u).filter((token) => token.length > 1))].slice(0, 160);
}

function latestSafeRelease(pkg) {
  const safe = (pkg.releases || []).filter((release) => !release.revoked && !release.yanked);
  const stable = safe.filter((release) => release.channel === 'stable');
  const source = stable.length ? stable : safe;
  return [...source].sort((a, b) => compareVersion(b.version, a.version))[0] || null;
}

function registryItem(pkg) {
  const release = latestSafeRelease(pkg);
  const name = pkg.metadata?.name || pkg.id;
  const description = pkg.metadata?.description || '';
  const capabilities = release?.capabilities || [];
  return {
    key: packageKey(pkg.type, pkg.id),
    id: pkg.id,
    type: pkg.type,
    version: release?.version || null,
    channel: release?.channel || 'stable',
    publisher: pkg.publisher_id || null,
    repo: pkg.source?.repo || '',
    commit: release?.commit || null,
    name,
    description,
    category: pkg.metadata?.category || 'other',
    capabilities,
    permissions: release?.permissions || [],
    stars: Number(pkg.metadata?.stars || 0),
    rank: Number(pkg.metadata?.rank || 0),
    verified: pkg.metadata?.verified === true,
    updated_at: pkg.metadata?.updated_at || release?.published_at || '',
    installable: Boolean(release),
    has_safe_release: Boolean(release),
    quarantine_reason: null,
    security: {
      yanked: release?.yanked === true,
      revoked: release?.revoked === true,
      advisories: Array.isArray(release?.security?.advisories) ? release.security.advisories.length : 0,
    },
    tokens: tokens([pkg.id, name, description, pkg.metadata?.category, pkg.publisher_id, pkg.source?.repo, ...capabilities].filter(Boolean).join(' ')),
  };
}

function discoveryOnlyItem(candidate) {
  const metadata = candidate.metadata || {};
  const publisher = candidate.publisher?.id || candidate.publisher?.login || null;
  const capabilities = candidate.type ? [candidate.type] : [];
  return {
    key: candidate.key,
    id: candidate.id,
    type: candidate.type,
    version: null,
    channel: 'stable',
    publisher,
    repo: candidate.repo || '',
    commit: candidate.commit || null,
    name: metadata.name || candidate.id,
    description: metadata.description || '',
    category: metadata.category || 'other',
    capabilities,
    permissions: [],
    stars: Number(metadata.stars || 0),
    rank: Number(metadata.rank || 0),
    verified: metadata.verified === true,
    updated_at: metadata.updated_at || candidate.discovered_at || '',
    installable: false,
    has_safe_release: false,
    quarantine_reason: candidate.reason || 'not-installable',
    security: { yanked: false, revoked: false, advisories: 0 },
    tokens: tokens([candidate.id, metadata.name, metadata.description, metadata.category, publisher, candidate.repo, ...capabilities].filter(Boolean).join(' ')),
  };
}

export function buildSearchIndexV3(registry, candidateReport = null) {
  if (!registry || registry.schema_version !== 4 || !Array.isArray(registry.packages)) throw new Error('Search Index V3 requires Registry V4');
  const map = new Map(registry.packages.map((pkg) => {
    const item = registryItem(pkg);
    return [item.key, item];
  }));
  if (candidateReport && Number(candidateReport.version) === 1 && Array.isArray(candidateReport.candidates)) {
    for (const candidate of candidateReport.candidates) {
      if (candidate.status !== 'quarantined' || !candidate.key || !candidate.type || !candidate.id || !candidate.repo) continue;
      if (!map.has(candidate.key)) map.set(candidate.key, discoveryOnlyItem(candidate));
    }
  }
  const items = [...map.values()];
  items.sort((a, b) => b.stars - a.stars || a.key.localeCompare(b.key));
  const hash = createHash('sha256').update(JSON.stringify(items)).digest('hex');
  return {
    version: 3,
    registry_schema_version: 4,
    registry_revision: registry.revision,
    generated_at: registry.generated_at || new Date().toISOString(),
    hash,
    count: items.length,
    installable_count: items.filter((item) => item.installable).length,
    discovery_only_count: items.filter((item) => !item.installable).length,
    items,
  };
}

async function readOptionalJson(file) {
  if (!file) return null;
  try { return JSON.parse(await readFile(resolve(file), 'utf8')); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function main() {
  const source = resolve(process.argv[2] || 'catalog/registry-v4.json');
  const target = resolve(process.argv[3] || 'site/public/catalog/search-index-v3.json');
  const candidateFile = process.argv[4] || 'catalog/registry-candidates-v1.json';
  const registry = JSON.parse(await readFile(source, 'utf8'));
  const candidates = await readOptionalJson(candidateFile);
  const index = buildSearchIndexV3(registry, candidates);
  await writeFile(target, `${JSON.stringify(index)}\n`, 'utf8');
  console.log(`Search Index V3 written: ${target} (${index.count}) installable=${index.installable_count} discovery_only=${index.discovery_only_count} revision=${index.registry_revision}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
}
