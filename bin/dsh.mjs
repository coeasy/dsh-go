#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
if (args[0] === 'provider') {
  const script = fileURLToPath(new URL('../runtime/provider-cli.mjs', import.meta.url));
  process.argv = [process.execPath, script, ...args.slice(1)];
  await import(pathToFileURL(resolve(script)).href);
} else {
  await import('./dsh-core.mjs');
}
