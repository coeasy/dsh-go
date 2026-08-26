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
import { loadRegistryFile } from '../runtime/resolver.mjs';
import { preflightPackage } from '../runtime/preflight.mjs';
import { findRuntimePackage, readRuntimeRegistry } from '../runtime/registry.mjs';
import { assertPackageType, parsePackageSpec } from '../runtime/package-model.mjs';
import { runDoctor } from '../runtime/doctor.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DEV_PACKAGE_ACTIONS = new Set(['init', 'validate', 'audit', 'sbom', 'publish-check']);
const PRODUCTION_COMMANDS = new Set(['ecosystem', 'preflight', 'bridge']);
const CONTROL_TOP_LEVEL = new Set(['profile', 'bundle', 'secret', 'transaction']);
const CONTROL_ACTIONS = Object.freeze({
  plugin: new Set(['config', 'remove', 'uninstall']),
  mcp: new Set(['config', 'start', 'stop', 'restart', 'logs', 'probe', 'invoke', 'process-status', 'remove', 'uninstall']),
  skill: new Set(['config', 'load', 'unload', 'inspect', 'invoke', 'remove', 'uninstall']),
  agent: new Set(['config', 'remove', 'uninstall']),
});

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

function usage() {
  console.log(`DSH Go CLI 0.1.0

Usage:
  dsh package install <type:id|type:owner/repo>[@version]
  dsh package list [--type plugin|mcp|skill|agent]
  dsh package status [type:id]
  dsh package init|validate|audit|sbom|publish-check ...
  dsh plugin install <id|owner/repo>[@version]
  dsh mcp install <id|owner/repo>[@version]
  dsh skill install <id|owner/repo>[@version]
  dsh agent install <id|owner/repo>[@version]
  dsh <plugin|mcp|skill|agent> list|status|update|rollback|remove|uninstall|enable|disable|doctor|repair|history
  dsh <plugin|mcp|skill|agent> config get|set|unset ...
  dsh mcp start|stop|restart|process-status|logs|probe|invoke ...
  dsh skill load|unload|inspect|invoke ...
  dsh doctor [package-id] [--type plugin|mcp|skill|agent] [--quick]
  dsh profile apply <profile.json> [--yes|--dry-run]
  dsh bundle install <bundle.json> [--yes|--dry-run]
  dsh secret set|get|list|delete ...
  dsh transaction recover
  dsh startup activate
  dsh runtime info
  dsh runtime doctor [package-id] [--type plugin|mcp|skill|agent] [--quick]
  dsh runtime check-update
  dsh runtime update [--dry-run]
  dsh host uri <package-spec> [--type <type>] [--channel <name>]
  dsh host parse <dsh://...>
  dsh host handle <dsh://...> [--yes|--dry-run]
  dsh host registration
  dsh host register
  dsh --version

Public release version remains 0.1.0 and canonical remote APIs remain under /api/v1.
Dangerous or unknown permissions require explicit --yes approval before any dependency is installed.
Dry-run is always non-mutating and never requires approval.
Host/deep-link mutation never executes without explicit local approval.
Install/update/repair/rollback/enable/disable operations never restart the client automatically.
The desktop client must call 'dsh startup activate' on its next startup to verify, bind,
and activate pending runtime packages.`);
}

function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function optionFrom(values, name) {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : undefined;
}

function positional(values, index) {
  const value = values[index];
  return value && !value.startsWith('--') ? value : undefined;
}

async function packageVersion() {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  return pkg.version;
}

async function version() {
  console.log(await packageVersion());
}

async function delegateScript(relativePath, nextArgs, options = {}) {
  const script = join(root, ...relativePath.split('/'));
  if (options.permissionAware) {
    if (nextArgs.includes('--yes')) process.env.DSH_PERMISSION_APPROVED = '1';
    else delete process.env.DSH_PERMISSION_APPROVED;
  }
  process.argv = [process.execPath, script, ...nextArgs];
  await import(pathToFileURL(script).href);
}

async function delegateRuntime(nextArgs) {
  return delegateScript('runtime/cli.mjs', nextArgs, { permissionAware: true });
}

async function delegateProduction(nextArgs) {
  return delegateScript('runtime/dsh.mjs', nextArgs, { permissionAware: true });
}

async function delegateControl(nextArgs) {
  return delegateScript('runtime/control-cli.mjs', nextArgs, { permissionAware: true });
}

function normalizedRuntimeArgs() {
  const command = args[0];
  if (!['package', 'plugin', 'mcp', 'skill', 'agent'].includes(command)) return args;
  const action = args[1];
  if (action === 'uninstall') return [command, 'remove', ...args.slice(2)];
  return args;
}

function isControlCommand(values) {
  const command = values[0];
  if (CONTROL_TOP_LEVEL.has(command)) return true;
  return Boolean(CONTROL_ACTIONS[command]?.has(values[1]));
}

async function mutationRequest(nextArgs) {
  const command = nextArgs[0];
  if (!command) return null;
  let type = optionFrom(nextArgs, '--type') || 'plugin';
  let action;
  let raw;
  let requestedVersion;

  if (['plugin', 'mcp', 'skill', 'agent'].includes(command)) {
    type = command;
    action = nextArgs[1];
    raw = positional(nextArgs, 2);
    requestedVersion = positional(nextArgs, 3);
  } else if (command === 'package') {
    action = nextArgs[1];
    raw = positional(nextArgs, 2);
  } else if (command === 'install') {
    action = 'install';
    raw = positional(nextArgs, 1);
  } else {
    return null;
  }

  if (!['install', 'add', 'update', 'repair'].includes(action) || !raw) return null;
  const parsed = parsePackageSpec(raw, requestedVersion || '*', assertPackageType(type));
  type = parsed.type;
  let spec = `${type}:${parsed.id}@${action === 'update' ? (requestedVersion || parsed.version || '*') : parsed.version}`;

  if (action === 'repair') {
    const runtime = await readRuntimeRegistry();
    const current = findRuntimePackage(runtime, parsed.id, { type });
    if (!current) throw new Error(`runtime package is not installed: ${type}:${parsed.id}`);
    spec = `${type}:${parsed.id}@${current.version}`;
  }
  return { type, action, spec };
}

async function authorizeMutation(nextArgs) {
  const request = await mutationRequest(nextArgs);
  if (!request) return null;
  const catalog = optionFrom(nextArgs, '--registry') || 'catalog/registry-v3.json';
  const channel = optionFrom(nextArgs, '--channel');
  const sourceRegistry = await loadRegistryFile(catalog);
  const runtimeRegistry = await readRuntimeRegistry();
  const preflight = preflightPackage(sourceRegistry, request.spec, {
    type: request.type,
    channel,
    installed: runtimeRegistry.packages,
  });
  if (!preflight.allowed) throw new Error(`preflight blocked ${request.action}: ${preflight.reasons.join('; ')}`);
  if (nextArgs.includes('--dry-run')) return preflight;
  const approved = nextArgs.includes('--yes');
  if (preflight.permissions.requires_consent && !approved) {
    const details = [...preflight.permissions.dangerous, ...preflight.permissions.unknown].join(', ');
    const error = new Error(`explicit permission consent required before install plan executes: ${details}`);
    error.code = 'DSH_PERMISSION_CONSENT_REQUIRED';
    error.permissionReport = preflight.permissions;
    throw error;
  }
  if (approved) process.env.DSH_PERMISSION_APPROVED = '1';
  return preflight;
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
    const dryRun = args.includes('--dry-run');
    if (dryRun) runtimeArgs.push('--dry-run');
    const registry = option('--registry');
    const rootOption = option('--root');
    if (registry) runtimeArgs.push('--registry', registry);
    if (rootOption) runtimeArgs.push('--root', rootOption);
    if (dryRun) {
      await authorizeMutation(runtimeArgs);
      await delegateRuntime(runtimeArgs);
      return;
    }
    if (!args.includes('--yes')) {
      print({ request, runtime_args: runtimeArgs, confirmation_required: true, executed: false, auto_restart: false });
      return;
    }
    runtimeArgs.push('--yes');
    await authorizeMutation(runtimeArgs);
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

async function doctorCommand(positionalIndex) {
  const result = await runDoctor(await packageVersion(), {
    id: positional(args, positionalIndex),
    type: option('--type'),
    quick: args.includes('--quick'),
    includeRemoved: args.includes('--all'),
  });
  print(result);
  if (result.status === 'failed') process.exitCode = 1;
}

async function runtimeCommand() {
  const action = args[1] || 'info';
  const current = await packageVersion();
  if (action === 'doctor') return doctorCommand(2);
  if (action === 'info') {
    const result = await runtimeEnvironment(current);
    print({ ...result, runtime_registry_schema: 3, package_types: ['plugin', 'mcp', 'skill', 'agent'], api_version: 'v1' });
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
  if (args[0] === 'doctor') return doctorCommand(1);
  if (args[0] === 'host') return hostCommand();
  if (args[0] === 'startup') return startupCommand();
  if (args[0] === 'runtime') return runtimeCommand();
  if (isControlCommand(args)) return delegateControl(args);
  if (PRODUCTION_COMMANDS.has(args[0])) return delegateProduction(args);
  if (args[0] === 'package' && DEV_PACKAGE_ACTIONS.has(args[1])) return delegateProduction(args);
  const nextArgs = normalizedRuntimeArgs();
  await authorizeMutation(nextArgs);
  await delegateRuntime(nextArgs);
}

main().catch((error) => {
  console.error('[dsh] ' + (error.stack || error.message));
  if (error.permissionReport) console.error(JSON.stringify(error.permissionReport, null, 2));
  if (error.compatibilityReport) console.error(JSON.stringify(error.compatibilityReport, null, 2));
  if (error.dependents) console.error(JSON.stringify({ dependents: error.dependents }, null, 2));
  process.exit(1);
});
