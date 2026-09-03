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
  } else if (args[0] === 'enterprise' || args[0] === 'organization') {
    const registrySelector = await import('../runtime/registry-cli-resolver.mjs');
    const selected = await registrySelector.resolveNamedRegistryArgs(args);
    process.argv = [...process.argv.slice(0, 2), ...selected.args];
    const enterprise = await import('../runtime/enterprise-cli.mjs');
    await enterprise.runEnterpriseCli(selected.args);
  } else {
    const normalizedArgs = normalizeInstallVersionArgs(args);
    const registrySelector = await import('../runtime/registry-cli-resolver.mjs');
    const selected = await registrySelector.resolveNamedRegistryArgs(normalizedArgs);
    const routedArgs = selected.args;
    process.argv = [...process.argv.slice(0, 2), ...routedArgs];
    const environment = await import('../runtime/environment-cli.mjs');
    if (environment.isEnvironmentCommand(routedArgs)) await environment.runEnvironmentCli(routedArgs);
    else {
      const manager = await import('../runtime/package-manager-v2-cli.mjs');
      if (manager.isPackageManagerV2Command(routedArgs)) await manager.runPackageManagerV2Cli(routedArgs);
      else {
        const offline = await import('../runtime/offline-cli.mjs');
        if (offline.isOfflineCommand(routedArgs)) await offline.runOfflineCli(routedArgs);
        else {
          const discovery = await import('../runtime/discovery-cli.mjs');
          if (discovery.isDiscoveryCommand(routedArgs)) await discovery.runDiscoveryCli(routedArgs);
          else {
            const guard = await import('../runtime/enterprise-guard.mjs');
            await guard.guardEnterpriseMutation(routedArgs);
            process.argv = [...process.argv.slice(0, 2), ...routedArgs];
            await import('./dsh-core.mjs');
          }
        }
      }
    }
  }
} catch (error) {
  printCliError(error, { prefix: '[dsh]', argv: args });
  process.exitCode = 1;
}
