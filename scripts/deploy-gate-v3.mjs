#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const checks = [
  'scripts/validate.mjs',
  'scripts/validate-registry-v3.mjs',
  'scripts/deploy-gate.mjs'
];

for (const check of checks) {
  const result = spawnSync('node', [check], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log('Deploy Gate V3 passed');
