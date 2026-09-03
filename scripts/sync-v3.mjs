#!/usr/bin/env node
/** Canonical DSH Registry V3 sync orchestrator. */
import { readFile, writeFile, rename, access, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { sha256 } from './checksum.mjs';
import { applyManifestObservation, buildFeed, observeDshManifest } from './sync.mjs';
import { canonicalRepoKey, mergeCatalogPluginsWithDiscovery } from './repository-identity.mjs';
import { buildRegistryV3 } from './registry-v3-builder.mjs';
import { buildDistributionDelta } from './registry-distribution.mjs';
import { discoverAllRepositories, discoveryRepoToLegacy } from './github-discovery.mjs';
import { validateRegistry } from './validate-registry-v3.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = resolve(ROOT, 'catalog');
const LEGACY_FILE = resolve(CATALOG, 'plugins.json');
const REGISTRY_FILE = resolve(CATALOG, 'registry-v3.json');
const META_FILE = resolve(CATALOG, 'meta.json');
const FEED_FILE = resolve(CATALOG, 'feed.xml');
const OBSERVED_FILE = resolve(CATALOG, '.sync-observed.json');
const SCHEMA_FILE = resolve(CATALOG, 'schema-v3.json');
const DISTRIBUTION_DELTA_FILE = resolve(CATALOG, 'distribution-delta.json');

async function readJson(file, fallback = null) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; } }
function runNode(args, env = process.env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`${args.join(' ')} exited ${code}`)));
  });
}
async function writeJsonAtomic(file, value) {
  const temp = `${file}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  try {
    await writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}
function parseMode() { if (process.argv.includes('--full')) return 'full'; if (process.argv.includes('--incremental')) return 'incremental'; return process.env.SYNC_MODE === 'full' ? 'full' : 'incremental'; }

function rebuildLegacyCatalog(source, plugins) {
  const now = Date.now();
  for (const plugin of plugins) {
    const updated7 = now - new Date(plugin.updated_at || 0).getTime() < 7 * 864e5 ? 1 : 0;
    const created30 = now - new Date(plugin.created_at || 0).getTime() < 30 * 864e5 ? 1 : 0;
    plugin.trend_score = Number(plugin.stars || 0) + 20 * updated7 + 10 * created30;
    // Defensive migration cleanup: old experimental liveness timestamps must never persist.
    delete plugin.observed_at;
  }
  plugins.sort((a, b) => (a.verified !== b.verified ? (a.verified ? -1 : 1) : Number(b.trend_score || 0) - Number(a.trend_score || 0)));
  plugins.forEach((plugin, index) => { plugin.rank = index + 1; });
  const byCategory = {}, byLanguage = {}, byLicense = {};
  let verified = 0;
  for (const plugin of plugins) {
    byCategory[plugin.category || 'other'] = (byCategory[plugin.category || 'other'] || 0) + 1;
    if (plugin.language) byLanguage[plugin.language] = (byLanguage[plugin.language] || 0) + 1;
    if (plugin.license) byLicense[plugin.license] = (byLicense[plugin.license] || 0) + 1;
    if (plugin.verified) verified++;
  }
  const etag = sha256(JSON.stringify(plugins)).slice(0, 16);
  return { ...source, meta: { ...(source.meta || {}), updated_at: new Date().toISOString(), count: plugins.length, etag, stats: { total: plugins.length, verified, by_category: byCategory, by_language: byLanguage, by_license: byLicense } }, plugins };
}

async function main() {
  const registryOnly = process.argv.includes('--registry-only');
  const mode = parseMode();
  if (!registryOnly) await runNode(['scripts/sync.mjs', mode === 'full' ? '--full' : '--incremental']);
  else await access(LEGACY_FILE);

  let legacy = await readJson(LEGACY_FILE);
  if (!legacy?.plugins?.length) throw new Error('legacy catalog is empty; refusing to build Registry V3');
  const existing = await readJson(REGISTRY_FILE, null);
  const observations = await readJson(OBSERVED_FILE, { mode: null, repos: [], repo_ids: [] });
  const needsCompleteDiscovery = mode === 'full' || !existing || existing.generated?.discovery_mode !== 'complete';
  let registryCatalog = legacy;
  let discoveryMode = existing?.generated?.discovery_mode || 'catalog';
  let discoveredCount = Number(existing?.generated?.discovered_count || 0);
  let discoveryTransport = existing?.generated?.discovery_transport || '';

  try {
    if (needsCompleteDiscovery) {
      console.log('[sync-v3] starting complete topic discovery using cursor pagination when authenticated');
      const discovery = await discoverAllRepositories('topic:dsh-plugin', { token: process.env.GITHUB_TOKEN || '' });
      discoveredCount = discovery.repositories.length;
      discoveryMode = 'complete';
      discoveryTransport = discovery.transport || 'unknown';
      const discoveredPlugins = discovery.repositories.map(discoveryRepoToLegacy).filter((plugin) => plugin.full_name && !plugin.disabled);
      const requireObservation = !registryOnly && mode === 'full';
      if (requireObservation && observations.mode !== 'full') {
        throw new Error('full sync observation sidecar missing or invalid; refusing stale-repository pruning');
      }

      // Legacy REST star buckets cannot enumerate every low-star repository. For records that
      // were not actually processed by the legacy full pass, observe dsh-plugin.json directly
      // so complete discovery does not create false-negative verification/name/category data.
      const observedKeys = new Set((observations.repos || []).map(canonicalRepoKey).filter(Boolean));
      const observedIds = new Set((observations.repo_ids || []).map((id) => String(id)).filter(Boolean));
      const legacyKeys = new Set((legacy.plugins || []).map((plugin) => canonicalRepoKey(plugin.full_name)).filter(Boolean));
      const legacyIds = new Set((legacy.plugins || []).map((plugin) => String(plugin.repo_id || '')).filter(Boolean));
      const targetIndexes = [];
      for (let index = 0; index < discoveredPlugins.length; index++) {
        const plugin = discoveredPlugins[index];
        const key = canonicalRepoKey(plugin.full_name);
        const id = String(plugin.repo_id || '');
        const alreadyObserved = requireObservation
          ? (observedKeys.has(key) || (id && observedIds.has(id)))
          : (legacyKeys.has(key) || (id && legacyIds.has(id)));
        if (!alreadyObserved) targetIndexes.push(index);
      }
      if (targetIndexes.length) {
        const manifestConcurrency = Math.max(1, Math.min(64, Number(process.env.REGISTRY_MANIFEST_CONCURRENCY || 32)));
        let manifestCursor = 0;
        let manifestObserved = 0;
        let manifestUncertain = 0;
        async function manifestWorker() {
          while (manifestCursor < targetIndexes.length) {
            const targetIndex = targetIndexes[manifestCursor++];
            const plugin = discoveredPlugins[targetIndex];
            const observation = await observeDshManifest(plugin.full_name, plugin.snapshot_ref || 'HEAD');
            if (observation.observed) {
              discoveredPlugins[targetIndex] = applyManifestObservation(plugin, observation);
              manifestObserved++;
            } else {
              manifestUncertain++;
              console.warn(`[sync-v3] manifest observation uncertain for ${plugin.full_name}: ${observation.error || observation.status}`);
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(manifestConcurrency, targetIndexes.length) }, manifestWorker));
        console.log(`[sync-v3] complete-discovery manifest backfill targets=${targetIndexes.length} observed=${manifestObserved} uncertain=${manifestUncertain}`);
      }

      const merged = mergeCatalogPluginsWithDiscovery(legacy.plugins || [], discoveredPlugins, {
        requireObservation,
        observedRepos: observations.repos || [],
        observedRepoIds: observations.repo_ids || [],
      });
      const canonicalLegacy = rebuildLegacyCatalog(legacy, merged.plugins);
      const legacyChanged = JSON.stringify(canonicalLegacy.plugins) !== JSON.stringify(legacy.plugins || []);
      if (legacyChanged) {
        await writeJsonAtomic(LEGACY_FILE, canonicalLegacy);
        await writeFile(FEED_FILE, buildFeed(canonicalLegacy.plugins), 'utf8');
        console.log(`[sync-v3] canonical legacy catalog repaired: renamed=${merged.renamed} pruned=${merged.pruned} count=${canonicalLegacy.plugins.length}`);
      }
      legacy = canonicalLegacy;
      registryCatalog = canonicalLegacy;
      console.log(`[sync-v3] complete discovery transport=${discoveryTransport} reported=${discovery.reported_total} unique=${discoveredCount} merged=${registryCatalog.plugins.length}`);
    }
  } finally {
    // Ephemeral liveness data is never published or committed.
    await unlink(OBSERVED_FILE).catch(() => {});
  }

  const { registry: candidate, stats } = await buildRegistryV3(registryCatalog, existing, {
    token: process.env.GITHUB_TOKEN || '', preserveExisting: !needsCompleteDiscovery, discoveryMode, discoveredCount,
  });
  candidate.generated.discovery_transport = discoveryTransport;

  const validation = validateRegistry(candidate);
  if (validation.errors.length) { validation.errors.slice(0, 50).forEach((error) => console.error('[REGISTRY ERROR]', error)); throw new Error(`Registry V3 validation failed with ${validation.errors.length} error(s)`); }
  validation.warns.slice(0, 50).forEach((warning) => console.warn(`[REGISTRY WARN] ${warning}`));

  // Delta metadata is small and belongs in Git; the thousands of shard/package
  // files are build artifacts generated later by copy-assets/site:build.
  const distributionDelta = buildDistributionDelta(candidate, existing);
  await writeJsonAtomic(DISTRIBUTION_DELTA_FILE, distributionDelta);

  const unchanged = existing?.generated?.content_hash === candidate.generated.content_hash;
  let published = candidate;
  if (unchanged && existing) { published = existing; console.log(`[sync-v3] registry content unchanged (${candidate.generated.content_hash})`); }
  else { await writeJsonAtomic(REGISTRY_FILE, candidate); console.log(`[sync-v3] registry updated: ${candidate.plugins.length} plugins, hash=${candidate.generated.content_hash}`); }

  const schemaHash = sha256(await readFile(SCHEMA_FILE, 'utf8'));
  const meta = await readJson(META_FILE, { history: [] });
  meta.registry_version = 3;
  meta.registry = {
    schema_version: published.schema_version, path: 'catalog/registry-v3.json', count: published.plugins.length, excluded_count: published.generated.excluded_count,
    source_catalog_etag: published.generated.source_catalog_etag, content_hash: published.generated.content_hash, schema_hash: schemaHash, generated_at: published.generated.at,
    discovery_mode: published.generated.discovery_mode || discoveryMode, discovery_transport: published.generated.discovery_transport || discoveryTransport,
    discovered_count: published.generated.discovered_count || discoveredCount,
    distribution: {
      version: 1,
      index_path: 'catalog/distribution-v1/index.json',
      delta_path: 'catalog/distribution-delta.json',
      shard_count: 256,
      package_records: true,
      content_hash: published.generated.content_hash,
      delta_content_hash: distributionDelta.content_hash,
      delta_changed: distributionDelta.counts.changed,
      delta_removed: distributionDelta.counts.removed,
    },
  };
  meta.pipeline = {
    stage: 'sync-v3', verified: true, frozen: true, registry_changed: !unchanged, run_at: new Date().toISOString(), source_catalog_etag: legacy.meta?.etag || '',
    mode: registryOnly ? 'registry-only' : mode, input_count: stats.input, output_count: stats.output, excluded_count: stats.excluded.length,
    distribution_version: 1, distribution_delta_hash: distributionDelta.content_hash,
  };
  await writeJsonAtomic(META_FILE, meta);
  console.log(`[sync-v3] complete mode=${registryOnly ? 'registry-only' : mode} input=${stats.input} output=${stats.output} reused=${stats.reused} pinned=${stats.pinned_from_discovery} resolved=${stats.resolved} excluded=${stats.excluded.length} delta=${distributionDelta.counts.changed}/${distributionDelta.counts.removed}`);
  stats.excluded.slice(0, 20).forEach((item) => console.warn(`[sync-v3] excluded ${item.repo || '<unknown>'}: ${item.reason}`));
}

main().catch((error) => { console.error('[sync-v3] failed:', error.stack || error.message); process.exit(1); });
