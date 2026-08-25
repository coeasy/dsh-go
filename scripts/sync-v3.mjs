#!/usr/bin/env node
/**
 * DSH Registry Sync V3
 * Stage 1: refresh the legacy catalog (unless --registry-only)
 * Stage 2: normalize/clean legacy records
 * Stage 3: pin every active repository to an immutable Git commit
 * Stage 4: generate + validate canonical catalog/registry-v3.json
 * Stage 5: atomically publish registry metadata into catalog/meta.json
 */
import { readFile, writeFile, rename, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { sha256 } from './checksum.mjs';
import { buildRegistryV3 } from './registry-v3-builder.mjs';
import { discoverAllRepositories, discoveryRepoToLegacy } from './github-discovery.mjs';
import { validateRegistry } from './validate-registry-v3.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = resolve(ROOT, 'catalog');
const LEGACY_FILE = resolve(CATALOG, 'plugins.json');
const REGISTRY_FILE = resolve(CATALOG, 'registry-v3.json');
const META_FILE = resolve(CATALOG, 'meta.json');
const SCHEMA_FILE = resolve(CATALOG, 'schema-v3.json');

async function readJson(file, fallback = null) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

function runNode(args, env = process.env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`${args.join(' ')} exited ${code}`)));
  });
}

async function writeJsonAtomic(file, value) {
  const temp = `${file}.tmp-${process.pid}`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await rename(temp, file);
}

function parseMode() {
  if (process.argv.includes('--full')) return 'full';
  if (process.argv.includes('--incremental')) return 'incremental';
  return process.env.SYNC_MODE === 'full' ? 'full' : 'incremental';
}

async function main() {
  const registryOnly = process.argv.includes('--registry-only');
  const mode = parseMode();

  if (!registryOnly) {
    const legacyArgs = ['scripts/sync.mjs', mode === 'full' ? '--full' : '--incremental'];
    await runNode(legacyArgs);
  } else {
    await access(LEGACY_FILE);
  }

  const legacy = await readJson(LEGACY_FILE);
  if (!legacy?.plugins?.length) throw new Error('legacy catalog is empty; refusing to build Registry V3');

  const existing = await readJson(REGISTRY_FILE, null);
  const needsCompleteDiscovery = mode === 'full' || !existing || existing.generated?.discovery_mode !== 'complete';
  let registryCatalog = legacy;
  let discoveryMode = 'catalog';
  let discoveredCount = 0;

  if (needsCompleteDiscovery) {
    console.log('[sync-v3] starting complete topic discovery (no 1000-result truncation allowed)');
    const discovery = await discoverAllRepositories('topic:dsh-plugin', {
      token: process.env.GITHUB_TOKEN || '',
    });
    discoveredCount = discovery.repositories.length;
    discoveryMode = 'complete';
    const byRepo = new Map((legacy.plugins || []).map((plugin) => [plugin.full_name, plugin]));
    for (const repo of discovery.repositories) {
      if (!byRepo.has(repo.full_name)) byRepo.set(repo.full_name, discoveryRepoToLegacy(repo));
    }
    registryCatalog = {
      ...legacy,
      meta: { ...(legacy.meta || {}), count: byRepo.size },
      plugins: [...byRepo.values()],
    };
    console.log(`[sync-v3] complete discovery reported=${discovery.reported_total} unique=${discoveredCount} merged=${registryCatalog.plugins.length}`);
  } else if (existing) {
    discoveryMode = existing.generated?.discovery_mode || 'preserved';
    discoveredCount = existing.generated?.discovered_count || existing.plugins?.length || 0;
  }

  const { registry: candidate, stats } = await buildRegistryV3(registryCatalog, existing, {
    token: process.env.GITHUB_TOKEN || '',
    preserveExisting: !needsCompleteDiscovery,
    discoveryMode,
    discoveredCount,
  });

  const validation = validateRegistry(candidate);
  if (validation.errors.length) {
    validation.errors.slice(0, 50).forEach((error) => console.error('[REGISTRY ERROR]', error));
    throw new Error(`Registry V3 validation failed with ${validation.errors.length} error(s)`);
  }
  validation.warns.slice(0, 50).forEach((warning) => console.warn('[REGISTRY WARN]', warning));

  const unchanged = existing?.generated?.content_hash === candidate.generated.content_hash;
  let published = candidate;
  if (unchanged && existing) {
    published = existing;
    console.log(`[sync-v3] registry content unchanged (${candidate.generated.content_hash}); keeping existing generated timestamp`);
  } else {
    await writeJsonAtomic(REGISTRY_FILE, candidate);
    console.log(`[sync-v3] registry updated: ${candidate.plugins.length} plugins, hash=${candidate.generated.content_hash}`);
  }

  const schemaHash = sha256(await readFile(SCHEMA_FILE, 'utf8'));
  const meta = await readJson(META_FILE, { history: [] });
  meta.registry_version = 3;
  meta.registry = {
    schema_version: published.schema_version,
    path: 'catalog/registry-v3.json',
    count: published.plugins.length,
    excluded_count: published.generated.excluded_count,
    source_catalog_etag: published.generated.source_catalog_etag,
    content_hash: published.generated.content_hash,
    schema_hash: schemaHash,
    generated_at: published.generated.at,
    discovery_mode: published.generated.discovery_mode || discoveryMode,
    discovered_count: published.generated.discovered_count || discoveredCount,
  };
  meta.pipeline = {
    stage: 'sync-v3',
    verified: true,
    frozen: true,
    registry_changed: !unchanged,
    run_at: new Date().toISOString(),
    source_catalog_etag: legacy.meta?.etag || '',
    mode: registryOnly ? 'registry-only' : mode,
    input_count: stats.input,
    output_count: stats.output,
    excluded_count: stats.excluded.length,
  };
  await writeJsonAtomic(META_FILE, meta);

  console.log(`[sync-v3] complete mode=${registryOnly ? 'registry-only' : mode} input=${stats.input} output=${stats.output} reused=${stats.reused} resolved=${stats.resolved} excluded=${stats.excluded.length}`);
  if (stats.excluded.length) {
    stats.excluded.slice(0, 20).forEach((item) => console.warn(`[sync-v3] excluded ${item.repo || '<unknown>'}: ${item.reason}`));
  }
}

main().catch((error) => {
  console.error('[sync-v3] failed:', error.stack || error.message);
  process.exit(1);
});
