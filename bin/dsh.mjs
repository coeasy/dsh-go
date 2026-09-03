#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeInstallVersionArgs } from '../runtime/command-normalizer.mjs';

const args = process.argv.slice(2);

try {
  if (args[0] === 'provider') {
    const script = fileURLToPath(new URL('../runtime/provider-cli.mjs', import.meta.url));
    process.argv = [process.execPath, script, ...args.slice(1)];
    await import(pathToFileURL(resolve(script)).href);
  } else {
    const normalizedArgs = normalizeInstallVersionArgs(args);
    process.argv = [...process.argv.slice(0, 2), ...normalizedArgs];
    const discovery = await import('../runtime/discovery-cli.mjs');
    if (discovery.isDiscoveryCommand(normalizedArgs)) await discovery.runDiscoveryCli(normalizedArgs);
    else await import('./dsh-core.mjs');
  }
} catch (error) {
  console.error('[dsh] ' + (error.stack || error.message));
  process.exit(1);
}
