#!/usr/bin/env node
/**
 * Registry V3 validation gate
 */
import { readFile } from 'node:fs/promises';

const FILE = new URL('../catalog/plugins.json', import.meta.url);

export function validateRegistry(data) {
  const errors = [];

  if (!data) {
    errors.push('registry empty');
    return errors;
  }

  if (data.registry_version && data.registry_version !== 3) {
    errors.push('registry_version must be 3');
  }

  const plugins = data.plugins || [];
  const ids = new Set();

  for (const plugin of plugins) {
    const id = plugin.id || plugin.slug;
    if (!id) errors.push('plugin missing id');
    if (ids.has(id)) errors.push(`duplicate id: ${id}`);
    ids.add(id);

    if (!plugin.version) errors.push(`${id}: missing version`);

    if (plugin.source && !plugin.source.commit) {
      errors.push(`${id}: missing commit`);
    }
  }

  return errors;
}

const data = JSON.parse(await readFile(FILE, 'utf8'));
const errors = validateRegistry(data);

if (errors.length) {
  errors.forEach((e) => console.error('[ERROR]', e));
  process.exit(1);
}

console.log('Registry V3 validation passed');
