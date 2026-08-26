#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildInstallUri,
  parseDshUri,
  protocolRegistration,
  registerProtocolHandler,
  runtimeArgsForRequest,
} from '../runtime/host-bridge.mjs';
import { activatePendingPackages } from '../runtime/startup.mjs';
import { checkForRuntimeUpdate, runtimeEnvironment, updateRuntime } from '../runtime/self-update.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

function usage() {
  console.log(`DSH Go CLI

Usage:
  dsh package install <type:id|type:owner/repo>[@version]
  dsh package list [--type plugin|mcp|skill|agent]
  dsh package status [type:id]
  dsh plugin install <id|owner/repo>[@version]
  dsh mcp install <id|owner/repo>[@version]
  dsh skill install <id|owner/repo>[@version]
  dsh agent install <id|owner/repo>[@version]
  dsh <plugin|mcp|skill|agent> list|status|update|rollback|remove|uninstall|enable|disable|doctor|repair|history
  dsh startup activate
  dsh runtime info
  dsh runtime check-update
  dsh runtime update [--dry-run]
  dsh host uri <package-spec> [--type <type>] [--channel <name>]
  dsh host parse <dsh://...>
  dsh host handle <dsh://...>
  dsh host registration
  dsh host register
  dsh --version

Host bridge contract:
  Plugin compatibility: dsh://plugin/install/<encoded-plugin-spec>
  Unified packages:     dsh://package/install/<type>/<encoded-package-spec>
  Legacy marketplace:   dsh://install?plugin=<owner/repo>

Install/update/repair/rollback/enable/disable operations never restart the client automatically.
The desktop client must call 'dsh startup activate' on its next startup to verify, bind,
and activate pending runtime packages.`);
}

function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function packageVersion() {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  return pkg.version;
}

async function version() {
  console.log(await packageVersion());
}

async function delegateRuntime(nextArgs) {
  const runtimeCli = join(root, 'runtime', 'cli.mjs');
  process.argv = [process.execPath, runtimeCli, ...nextArgs];
  await import(pathToFileURL(runtimeCli).href);
}

function normalizedRuntimeArgs() {
  const command = args[0];
  if (!['package', 'plugin', 'mcp', 'skill', 'agent'].includes(command)) return args;
  const action = args[1];
  if (action === 'uninstall') return [command, 'remove', ...args.slice(2)];
  return args;
}

async function hostCommand() {
  const action = args[1] || 'registration';
  if (action === 'uri') {
    const spec = args[2];
    console.log(buildInstallUri(spec, { type: option('--type'), channel: option('--channel') }));
    return;
  }
  if (action === 'parse') {
    print(parseDshUri(args[2]));
    return;
  }
  if (action === 'registration') {
    print(protocolRegistration({ executable: process.execPath, scriptPath: fileURLToPath(import.meta.url) }));
    return;
  }
  if (action === 'register') {
    const result = await registerProtocolHandler({ executable: process.execPath, scriptPath: fileURLToPath(import.meta.url) });
    print(result);
    if (!result.registered && result.requires_client_bundle) process.exitCode = 2;
    return;
  }
  if (action === 'handle') {
    const request = parseDshUri(args[2]);
    const runtimeArgs = runtimeArgsForRequest(request);
    if (args.includes('--dry-run')) runtimeArgs.push('--dry-run');
    const registry = option('--registry');
    const rootOption = option('--root');
    if (registry) runtimeArgs.push('--registry', registry);
    if (rootOption) runtimeArgs.push('--root', rootOption);
    await delegateRuntime(runtimeArgs);
    return;
  }
  throw new Error(`unknown host action: ${action}`);
}

async function startupCommand() {
  const action = args[1] || 'activate';
  if (action !== 'activate') throw new Error(`unknown startup action: ${action}`);
  const result = await activatePendingPackages({ registryFile: option('--registry') });
  print(result);
  if (!result.healthy) process.exitCode = 1;
}

async function runtimeCommand() {
  const action = args[1] || 'info';
  const current = await packageVersion();
  if (action === 'info' || action === 'doctor') {
    const result = await runtimeEnvironment(current);
    print({ ...result, runtime_registry_schema: 3, package_types: ['plugin', 'mcp', 'skill', 'agent'] });
    if (!result.node_supported) process.exitCode = 1;
    return;
  }
  if (action === 'check-update') {
    print(await checkForRuntimeUpdate(current));
    return;
  }
  if (action === 'update') {
    print(await updateRuntime(current, { dryRun: args.includes('--dry-run') }));
    return;
  }
  throw new Error(`unknown runtime action: ${action}`);
}

async function main() {
  if (args.length === 0 || args.includes('--help') || args.includes('-h') || args[0] === 'help') {
    usage();
    return;
  }
  if (args[0] === '--version' || args[0] === '-v' || args[0] === 'version') return version();
  if (args[0] === 'host') return hostCommand();
  if (args[0] === 'startup') return startupCommand();
  if (args[0] === 'runtime') return runtimeCommand();
  await delegateRuntime(normalizedRuntimeArgs());
}

main().catch((error) => {
  console.error('[dsh] ' + (error.stack || error.message));
  process.exit(1);
});
