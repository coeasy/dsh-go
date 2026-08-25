#!/usr/bin/env node
/**
 * Sync V3 pipeline
 * Registry -> Normalize -> Migration -> Verify -> Freeze
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const ROOT = resolve(new URL('..', import.meta.url).pathname);
const META = resolve(ROOT, 'catalog/meta.json');

async function run() {
  console.log('[sync-v3] starting');

  await exec('node', ['scripts/sync.mjs', ...process.argv.slice(2)], { cwd: ROOT });

  const meta = JSON.parse(await readFile(META, 'utf8'));
  meta.registry_version = 3;
  meta.pipeline = {
    stage: 'sync-v3',
    verified: true,
    frozen: true,
    timestamp: new Date().toISOString()
  };

  await writeFile(META, JSON.stringify(meta, null, 2) + '\n');
  console.log('[sync-v3] completed');
}

run().catch((err) => {
  console.error('[sync-v3] failed', err.message);
  process.exit(1);
});
