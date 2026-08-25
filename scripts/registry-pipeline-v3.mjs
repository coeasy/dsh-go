#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

for (const [file, args] of [
  ['scripts/validate.mjs', []],
  ['scripts/validate-registry-v3.mjs', []],
  ['runtime/cli.mjs', ['check-registry']],
]) {
  const result = spawnSync(process.execPath, [file, ...args], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Registry V3 pipeline validation completed');
