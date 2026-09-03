#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeInstallVersionArgs } from '../runtime/command-normalizer.mjs';
import { isHelpRequest, nativePackageManagerHelp } from '../runtime/cli-help.mjs';
import { applyGlobalCliOptions } from '../runtime/cli-global-options.mjs';
import { cliJsonMode, printCliError, printCliValue } from '../runtime/cli-output.mjs';

let args = process.argv.slice(2);

try {
  const global = applyGlobalCliOptions(args);
  args = global.args;
  process.argv = [...process.argv.slice(0, 2), ...args];

  if (isHelpRequest(args)) {
    const help = nativePackageManagerHelp(global.language);
    if (cliJsonMode()) printCliValue({ language: global.language, help }, { command: 'help' });
    else console.log(help);
  } else if (args[0] === 'provider') {
    const script = fileURLToPath(new URL('../runtime/provider-cli.mjs', import.meta.url));
    process.argv = [process.execPath, script, ...args.slice(1)];
    await import(pathToFileURL(resolve(script)).href);
  } else {
    const normalizedArgs = normalizeInstallVersionArgs(args);
    process.argv = [...process.argv.slice(0, 2), ...normalizedArgs];
    const registry = await import('../runtime/registry-cli.mjs');
    if (registry.isRegistryCommand(normalizedArgs)) await registry.runRegistryCli(normalizedArgs);
    else {
      const environment = await import('../runtime/environment-cli.mjs');
      if (environment.isEnvironmentCommand(normalizedArgs)) await environment.runEnvironmentCli(normalizedArgs);
      else {
        const offline = await import('../runtime/offline-cli.mjs');
        if (offline.isOfflineCommand(normalizedArgs)) await offline.runOfflineCli(normalizedArgs);
        else {
          const discovery = await import('../runtime/discovery-cli.mjs');
          if (discovery.isDiscoveryCommand(normalizedArgs)) await discovery.runDiscoveryCli(normalizedArgs);
          else await import('./dsh-core.mjs');
        }
      }
    }
  }
} catch (error) {
  printCliError(error, { prefix: '[dsh]', argv: args });
  process.exitCode = 1;
}
