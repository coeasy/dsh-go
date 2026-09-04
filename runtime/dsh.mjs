#!/usr/bin/env node
import { loadRuntimeRegistryV4 } from './registry-client.mjs';
import { listPackages, packageInfo, planPackage, runtimeStatus, verifyPackageRequest } from './package-service.mjs';
import {
  supervisedActivate,
  supervisedInstall,
  supervisedRemove,
  supervisedRollback,
  supervisedSetEnabled,
  supervisedUpdate,
} from './supervisor.mjs';
import { parseDshUri, registerProtocolHandler } from './host-bridge.mjs';
import { runProviderCli } from './provider-cli.mjs';
import { runEnvironmentCli } from './environment-cli.mjs';
import { readDshManifest, manifestSourceSummary } from './package-manifest.mjs';
import { auditPackageSecurity } from '../scripts/package-security-audit.mjs';
import { PACKAGE_TYPES, RELEASE_CHANNELS, formatPackageCoordinate } from '../packages/protocol-core/index.mjs';

const HELP = `DSH Go · canonical CLI

Usage:
  dsh package install <type:id@range> [--channel stable] --yes [--dry-run]
  dsh package install-link <dsh://package/install?...> --yes
  dsh package update <type:id@range> --yes [--channel stable]
  dsh package remove <type:id@range> --yes
  dsh package rollback <type:id@range> --yes
  dsh package enable <type:id@range> --yes
  dsh package disable <type:id@range> --yes
  dsh package verify <type:id@range>
  dsh package info <type:id@range>
  dsh package list [--all]
  dsh package plan <type:id@range> [--channel stable]
  dsh package validate <package-directory>
  dsh package audit <package-directory>

  dsh registry status [--registry <https-url-or-file>]
  dsh registry package <type:id@range> [--channel stable]

  dsh runtime status
  dsh runtime activate --yes
  dsh runtime register-protocol

  dsh provider <list|search|info|install|update|rollback> ...
  dsh environment <lock|verify-lock|restore> ...

Global:
  --json
  --registry <https-url-or-file>
  --runtime-registry <file>
  --channel <stable|beta|nightly|dev>
  --yes
  --dry-run

Canonical package coordinate is mandatory for registry/runtime package operations: <type>:<id>@<range>.
Package source validation accepts only Manifest V2 dsh-package.json.
Package types: ${PACKAGE_TYPES.join(', ')}.
Channels: ${RELEASE_CHANNELS.join(', ')}.
All local mutations require explicit --yes approval and are serialized by Runtime Supervisor.
Legacy plugin aliases, implicit package types, github: specs, Manifest V1 and old command shapes are not supported.`;

function option(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function positional(args) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value.startsWith('--')) {
      if (!['--json', '--yes', '--dry-run', '--force', '--all'].includes(value)) index += 1;
      continue;
    }
    values.push(value);
  }
  return values;
}

function commonOptions(args) {
  return {
    registry: option(args, '--registry'),
    registryFile: option(args, '--runtime-registry'),
    channel: option(args, '--channel', 'stable'),
    approved: args.includes('--yes'),
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    all: args.includes('--all'),
    source: 'cli',
  };
}

function output(value, json = false) {
  if (json || typeof value === 'object') console.log(JSON.stringify(value, null, 2));
  else console.log(String(value));
}

async function validatePackageDirectory(root) {
  const result = await readDshManifest(root);
  return {
    ok: true,
    file: result.file,
    manifest: result.manifest,
    summary: manifestSourceSummary(result.manifest),
    trust_established: false,
    note: 'Manifest validation proves package structure only; publisher ownership and cryptographic release trust are established by Registry V4/release verification.',
  };
}

async function runPackage(args, options) {
  const action = args[0];
  const target = positional(args.slice(1))[0];
  if (action === 'list') return { packages: await listPackages(options) };
  if (action === 'validate') {
    if (!target) throw new Error('package validate requires a package directory containing dsh-package.json');
    return validatePackageDirectory(target);
  }
  if (action === 'audit') {
    if (!target) throw new Error('package audit requires a package directory containing dsh-package.json');
    const report = await auditPackageSecurity(target);
    if (!report.safe) {
      const error = new Error(`package source audit failed: undeclared permissions=${report.undeclared_permissions.join(', ') || 'none'}`);
      error.code = 'DSH_PACKAGE_AUDIT_FAILED';
      error.report = report;
      throw error;
    }
    return report;
  }
  if (action === 'install-link') {
    if (!target) throw new Error('package install-link requires a canonical dsh://package/install URL');
    const link = parseDshUri(target);
    return supervisedInstall(link.request, { ...options, channel: link.request.channel, source: 'deep-link-cli' });
  }
  if (!target) throw new Error(`package ${action || '<command>'} requires canonical coordinate <type>:<id>@<range>`);
  if (action === 'install') return supervisedInstall(target, options);
  if (action === 'update') return supervisedUpdate(target, options);
  if (action === 'remove') return supervisedRemove(target, options);
  if (action === 'rollback') return supervisedRollback(target, options);
  if (action === 'enable') return supervisedSetEnabled(target, true, options);
  if (action === 'disable') return supervisedSetEnabled(target, false, options);
  if (action === 'verify') return verifyPackageRequest(target, options);
  if (action === 'info') return packageInfo(target, options);
  if (action === 'plan') return planPackage(target, options);
  throw new Error(`unknown package command: ${action || '<empty>'}`);
}

async function runRegistry(args, options) {
  const action = args[0] || 'status';
  const registry = await loadRuntimeRegistryV4(options);
  if (action === 'status') return {
    schema_version: registry.schema_version,
    revision: registry.revision,
    generated_at: registry.generated_at,
    package_count: registry.packages.length,
    release_count: registry.metadata?.release_count ?? registry.packages.reduce((sum, item) => sum + item.releases.length, 0),
  };
  if (action === 'package') {
    const coordinate = positional(args.slice(1))[0];
    if (!coordinate) throw new Error('registry package requires canonical coordinate');
    const plan = await planPackage(coordinate, { ...options, registryData: registry });
    return {
      coordinate: formatPackageCoordinate({ type: plan.root.type, id: plan.root.id, range: plan.root.version, channel: plan.root.channel }),
      resolved: plan.root,
      registry_revision: plan.registry_revision,
    };
  }
  throw new Error(`unknown registry command: ${action}`);
}

async function runRuntime(args, options) {
  const action = args[0] || 'status';
  if (action === 'status') return runtimeStatus(options);
  if (action === 'activate') return supervisedActivate(options);
  if (action === 'register-protocol') return registerProtocolHandler();
  throw new Error(`unknown runtime command: ${action}`);
}

export async function runDsh(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help') || args.includes('-h') || args[0] === 'help') {
    console.log(HELP);
    return { help: true };
  }
  const namespace = args[0];
  const rest = args.slice(1);
  const options = commonOptions(args);
  let result;
  if (namespace === 'package') result = await runPackage(rest, options);
  else if (namespace === 'registry') result = await runRegistry(rest, options);
  else if (namespace === 'runtime') result = await runRuntime(rest, options);
  else if (namespace === 'provider') result = await runProviderCli(rest);
  else if (namespace === 'environment') result = await runEnvironmentCli(rest);
  else throw new Error(`unknown namespace: ${namespace}. Use one of: package, registry, runtime, provider, environment`);
  output(result, args.includes('--json'));
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDsh().catch((error) => {
    console.error(`[dsh] ${error.code ? `${error.code}: ` : ''}${error.message}`);
    if (process.env.DSH_DEBUG === '1' && error.stack) console.error(error.stack);
    process.exitCode = 1;
  });
}
