#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packageTrust, popularityScore } from '../runtime/trust-model.mjs';
import { applyLocalizationOverlay, normalizeMarketplaceLocale } from '../runtime/localization-overlay.mjs';

function tokens(value) {
  return [...new Set(String(value || '').toLocaleLowerCase().split(/[^\p{L}\p{N}_.-]+/u).filter((token) => token.length > 1))].slice(0, 160);
}

function releaseChannel(item) { return item.channel || item.release_channel || 'stable'; }
function typeOf(item) { return item.type || item.runtime?.type || 'plugin'; }

export function buildSearchIndexV3(registry, options = {}) {
  const locale = normalizeMarketplaceLocale(options.locale || 'en');
  const overlay = options.overlay || { entries: {} };
  const items = (registry.plugins || []).map((item) => {
    const type = typeOf(item);
    const presentation = applyLocalizationOverlay({ ...item, type }, overlay, locale);
    const trust = packageTrust(item);
    const popularity = popularityScore(item);
    return {
      key: `${type}:${item.id}`,
      id: item.id,
      type,
      version: item.version,
      channel: releaseChannel(item),
      publisher: item.publisher?.id || item.source?.repo?.split('/')[0] || null,
      repo: item.source?.repo || '',
      commit: item.source?.commit || null,
      name: presentation.name,
      description: presentation.description,
      category: item.metadata?.category || 'other',
      capabilities: item.capabilities || [],
      permissions: item.permissions || [],
      trust,
      popularity,
      security: {
        yanked: item.security?.yanked === true,
        revoked: item.security?.revoked === true,
        advisories: Array.isArray(item.security?.advisories) ? item.security.advisories.length : 0,
      },
      tokens: tokens([item.id, presentation.name, presentation.description, item.metadata?.category, item.publisher?.id, item.source?.repo, ...(item.capabilities || []), ...(item.provides || [])].filter(Boolean).join(' ')),
    };
  });
  items.sort((a, b) => a.key.localeCompare(b.key) || b.version.localeCompare(a.version, undefined, { numeric: true }));
  const hash = createHash('sha256').update(JSON.stringify(items)).digest('hex');
  return {
    version: 3,
    locale,
    generated_at: registry.generated?.at || new Date().toISOString(),
    registry_hash: registry.generated?.content_hash || '',
    localization_hash: options.localizationHash || null,
    hash,
    count: items.length,
    items,
  };
}

async function main() {
  const source = resolve(process.argv[2] || 'catalog/registry-v3.json');
  const target = resolve(process.argv[3] || 'catalog/search-index-v3.json');
  const locale = process.argv[4] || 'en';
  const overlayFile = process.argv[5];
  const registry = JSON.parse(await readFile(source, 'utf8'));
  const overlay = overlayFile ? JSON.parse(await readFile(resolve(overlayFile), 'utf8')) : { entries: {} };
  const index = buildSearchIndexV3(registry, { locale, overlay });
  await writeFile(target, `${JSON.stringify(index)}\n`, 'utf8');
  console.log(`Search Index V3 written: ${target} (${index.count})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
}
