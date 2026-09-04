#!/usr/bin/env node
import { access, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { buildRegistryV4FromDiscovery } from './registry-v4-source.mjs';
import { validateRegistryV4 } from '../packages/registry-core/index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = resolve(ROOT, 'catalog');
const DISCOVERY_FILE = resolve(CATALOG, 'plugins.json');
const REGISTRY_FILE = resolve(CATALOG, 'registry-v4.json');
const CANDIDATE_FILE = resolve(CATALOG, 'registry-candidates-v1.json');
const META_FILE = resolve(CATALOG, 'meta.json');

async function readJson(file, fallback = null) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}
async function writeJsonAtomic(file, value) {
  const temp = `${file}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}
function runNode(args, env = process.env) {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? accept() : reject(new Error(`${args.join(' ')} exited ${code}`)));
  });
}
function mode() {
  if (process.argv.includes('--full')) return 'full';
  if (process.argv.includes('--registry-only')) return 'registry-only';
  return 'incremental';
}

async function main() {
  const syncMode = mode();
  if (syncMode !== 'registry-only') {
    // Source discovery is an internal candidate input. It is never a Runtime
    // installation authority and is never copied as a public compatibility API.
    await runNode(['scripts/sync.mjs', syncMode === 'full' ? '--full' : '--incremental']);
  } else await access(DISCOVERY_FILE);

  const discovery = await readJson(DISCOVERY_FILE);
  if (!discovery?.plugins?.length) throw new Error('discovery catalog is empty; refusing to publish Registry V4');

  const { registry, candidates, stats } = await buildRegistryV4FromDiscovery(discovery, {
    token: process.env.GITHUB_TOKEN || '',
    generated_at: process.env.DSH_GENERATED_AT || new Date().toISOString(),
  });
  validateRegistryV4(registry);
  await writeJsonAtomic(REGISTRY_FILE, registry);
  await writeJsonAtomic(CANDIDATE_FILE, candidates);

  const meta = await readJson(META_FILE, {});
  meta.registry_version = 4;
  meta.registry = {
    schema_version: 4,
    path: 'catalog/registry-v4.json',
    revision: registry.revision,
    count: registry.packages.length,
    release_count: registry.metadata.release_count,
    candidate_count: candidates.candidates.length,
    quarantined_count: stats.quarantined,
    rejected_count: stats.rejected,
    generated_at: registry.generated_at,
    distribution: { version: 2, index_path: 'catalog/registry-v4/index.json' },
    search_index: { version: 3, path: 'catalog/search-index-v3.json' },
  };
  meta.pipeline = {
    stage: 'sync-v4',
    mode: syncMode,
    verified: true,
    run_at: new Date().toISOString(),
    input_count: stats.input,
    output_count: stats.output,
    accepted_count: stats.accepted,
    quarantined_count: stats.quarantined,
    rejected_count: stats.rejected,
  };
  await writeJsonAtomic(META_FILE, meta);

  console.log(`[sync-v4] complete mode=${syncMode} installable=${registry.packages.length} releases=${registry.metadata.release_count} revision=${registry.revision} quarantined=${stats.quarantined} rejected=${stats.rejected}`);
  stats.excluded.slice(0, 30).forEach((item) => console.warn(`[sync-v4] ${item.status} ${item.repo || '<unknown>'}: ${item.reason}`));
}

main().catch((error) => {
  console.error('[sync-v4] failed:', error.stack || error.message);
  process.exit(1);
});
