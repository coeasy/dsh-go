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
    // `sync.mjs` is the source-discovery collector only. Its JSON output is an
    // internal build input, never a public Registry compatibility surface.
    await runNode(['scripts/sync.mjs', syncMode === 'full' ? '--full' : '--incremental']);
  } else await access(DISCOVERY_FILE);

  const discovery = await readJson(DISCOVERY_FILE);
  if (!discovery?.plugins?.length) throw new Error('discovery catalog is empty; refusing to publish Registry V4');

  const { registry, stats } = await buildRegistryV4FromDiscovery(discovery, {
    token: process.env.GITHUB_TOKEN || '',
    generated_at: process.env.DSH_GENERATED_AT || new Date().toISOString(),
  });
  validateRegistryV4(registry);
  await writeJsonAtomic(REGISTRY_FILE, registry);

  const meta = await readJson(META_FILE, {});
  meta.registry_version = 4;
  meta.registry = {
    schema_version: 4,
    path: 'catalog/registry-v4.json',
    revision: registry.revision,
    count: registry.packages.length,
    release_count: registry.metadata.release_count,
    excluded_count: stats.excluded.length,
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
    excluded_count: stats.excluded.length,
  };
  await writeJsonAtomic(META_FILE, meta);

  console.log(`[sync-v4] complete mode=${syncMode} packages=${registry.packages.length} releases=${registry.metadata.release_count} revision=${registry.revision} excluded=${stats.excluded.length}`);
  stats.excluded.slice(0, 30).forEach((item) => console.warn(`[sync-v4] excluded ${item.repo || '<unknown>'}: ${item.reason}`));
}

main().catch((error) => {
  console.error('[sync-v4] failed:', error.stack || error.message);
  process.exit(1);
});
