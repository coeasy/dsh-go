#!/usr/bin/env node
/**
 * Deploy Gate
 * Blocks deployment when registry integrity is invalid.
 */
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const FILE = resolve(ROOT, 'catalog/meta.json');

async function main() {
  await access(FILE);
  const meta = JSON.parse(await readFile(FILE, 'utf8'));
  const errors = [];

  if (meta.registry_version !== 3) {
    errors.push('registry_version must be 3');
  }

  if (!meta.pipeline?.verified) {
    errors.push('sync pipeline not verified');
  }

  if (errors.length) {
    errors.forEach((e) => console.error('[DEPLOY BLOCK]', e));
    process.exit(1);
  }

  console.log('Deploy gate passed');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
