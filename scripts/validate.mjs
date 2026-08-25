#!/usr/bin/env node
/**
 * DSH Go validation gate
 * Registry + catalog validation entry point
 */
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = resolve(ROOT, 'catalog/plugins.json');

export function validateCatalog(data) {
  const errors = [];

  if (!Array.isArray(data.plugins)) errors.push('plugins must be array');

  const ids = new Set();
  for (const plugin of data.plugins || []) {
    const id = plugin.id || plugin.slug;
    if (!id) errors.push('plugin missing id');
    if (ids.has(id)) errors.push(`duplicate plugin: ${id}`);
    ids.add(id);
  }

  return errors;
}

async function main() {
  const data = JSON.parse(await readFile(FILE, 'utf8'));
  const errors = validateCatalog(data);

  if (errors.length) {
    errors.forEach((e) => console.error('[ERROR]', e));
    process.exit(1);
  }

  console.log(`Validation passed: ${data.plugins.length} plugins`);
}

main();
