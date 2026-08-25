#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

function run(cmd) {
  const result = spawnSync('node', [cmd], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

// V3 pipeline gate: migration -> verify -> runtime check
run('scripts/migration-v3.mjs');
run('scripts/validate-registry-v3.mjs');
run('runtime/resolver.mjs');
console.log('Registry V3 pipeline completed');
