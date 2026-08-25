#!/usr/bin/env node
import { buildRegistry } from './registry-builder.mjs';
import { validateRegistryV3 } from './validate-registry-v3.mjs';

export function runSyncV3(plugins = [], commit = '') {
  const registry = buildRegistry(plugins, commit);
  const errors = validateRegistryV3(registry);
  if (errors.length) {
    throw new Error(`Registry V3 validation failed: ${errors.join(', ')}`);
  }
  return registry;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(runSyncV3([], ''), null, 2));
}
