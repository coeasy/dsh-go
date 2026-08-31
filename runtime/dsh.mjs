#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { ensureRegistryCache, loadRegistrySource, resolveRegistrySource } from './catalog.mjs';
import { buildInstallDeepLink, deepLinkInstallPlan, parseDshUrl, registerProtocolHandler } from './client-bridge.mjs';
import { findPackageManifest, writeManifestTemplate } from './package-manifest.mjs';
import { preflightPackage } from './preflight.mjs';
import { assertPackageType, parsePackageSpec } from './package-model.mjs';
import { findRuntimePackage, readRuntimeRegistry } from './registry.mjs';
import { versionInfo } from './version.mjs';
import { startClientHost } from './client-host.mjs';
import { executePackageTransaction } from './transaction.mjs';
import { auditPackageSecurity } from '../scripts/package-security-audit.mjs';
import { generateSbom } from '../scripts/generate-sbom.mjs';

const LEGACY_CLI = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const ECOSYSTEM_TYPES = new Set(['plugin', 'mcp', 'skill', 'agent']);
const MUTATING_ACTIONS = new Set(['install', 'add', 'update', 'repair']);

function option(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}
function has(args, name) { return args.includes(name); }
function stripFlag(args, name) { return args.filter((value) => value !== name); }
function print(value) { console.log(JSON.stringify(value, null, 2)); }

function help() {
  console.log(`DSH CLI 0.1.0 - local runtime and ecosystem manager

Usage:
  dsh version
  dsh plugin|mcp|skill|agent install <id[@version]> [--channel stable] [--yes] [--dry-run]
  dsh plugin|mcp|skill|agent list|status|update|remove|rollback|doctor|repair|enable|disable|history ...
  dsh ecosystem list|status
  dsh preflight <id[@version]> [--type plugin|mcp|skill|agent]
  dsh bridge link <id[@version]> [--type plugin|mcp|skill|agent]
  dsh bridge parse <dsh://...>
  dsh bridge register [--dry-run]
  dsh bridge handle <dsh://...> [--yes]
  dsh bridge serve [--port 43731]
  dsh package init|validate|audit|sbom|publish-check ...
  dsh profile apply <profile.json> [--yes|--dry-run]
  dsh bundle install <bundle.json> [--yes|--dry-run]

Public release version remains 0.1.0 and remote APIs remain under /api/v1.
Install/update never restarts the client automatically. Successful changes are activated by the startup loader after a manual restart.`);
}

async function registryContext(args) {
  const explicit = option(args, '--registry');
  const source = await resolveRegistrySource(explicit);
  const registry = await loadRegistrySource(source);
  const file = await ensureRegistryCache(source);
  return { registry, file, source };
}

async function confirm(message) {
  if (!input.isTTY || !output.isTTY) return false;
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`${message} [y/N] `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally { rl.close(); }
}

async function runLegacy(args, registryFile, approved = false) {
  const forwarded = [...args];
  if (registryFile && !forwarded.includes('--registry')) forwarded.push('--registry', registryFile);
  const env = { ...process.env };
  if (approved) env.DSH_PERMISSION_APPROVED = '1';
  else delete env.DSH_PERMISSION_APPROVED;
  const exitCode = await new Promise((accept, reject) => {
    const child = spawn(process.execPath, [LEGACY_CLI, ...forwarded], { stdio: 'inherit', windowsHide: false, env });
    child.on('error', reject);
    child.on('exit', (code, signal) => signal ? reject(new Error(`runtime terminated by ${signal}`)) : accept(code ?? 1));
  });
  if (exitCode !== 0) throw new Error(`runtime command failed with exit code ${exitCode}`);
}

async function approvedPreflight(type, spec, args) {
  const ctx = await registryContext(args);
  const channel = option(args, '--channel');
  const runtimeRegistry = await readRuntimeRegistry();
  const preflight = preflightPackage(ctx.registry, spec, { type, channel, installed: runtimeRegistry.packages });
  if (!preflight.allowed) throw new Error(`preflight blocked operation: ${preflight.reasons.join('; ')}`);
  if (has(args, '--dry-run')) return { ctx, preflight, approved: false };
  let approved = has(args, '--yes');
  const escalated = preflight.permission_diff.added.filter((permission) => preflight.permissions.dangerous.includes(permission) || preflight.permissions.unknown.includes(permission));
  if ((preflight.permissions.requires_consent || escalated.length) && !approved) {
    const packageCount = preflight.dependency_plan?.order?.length || 1;
    approved = await confirm(`${packageCount} package(s) request ${preflight.permissions.permissions.join(', ') || 'no special permissions'}. Continue?`);
    if (!approved) {
      const error = new Error('operation cancelled: explicit permission consent is required');
      error.code = 'DSH_PERMISSION_CONSENT_REQUIRED';
      error.permissionReport = preflight.permissions;
      throw error;
    }
  }
  return { ctx, preflight, approved };
}

async function installOrUpdate(type, action, spec, args) {
  if (!spec) throw new Error(`${action} requires a package id`);
  const normalizedType = assertPackageType(type);
  const { ctx, preflight, approved } = await approvedPreflight(normalizedType, spec, args);
  if (has(args, '--dry-run')) {
    print({ ...preflight, deep_link: buildInstallDeepLink({ id: preflight.id, version: preflight.version, channel: preflight.channel, type: preflight.type }) });
    return;
  }

  const parsed = parsePackageSpec(spec, action === 'update' ? '*' : preflight.version, normalizedType);
  const flags = [];
  const channel = option(args, '--channel');
  if (channel) flags.push('--channel', channel);
  if (has(args, '--force')) flags.push('--force');
  let runtimeArgs;
  if (action === 'update') runtimeArgs = [normalizedType, 'update', parsed.id, parsed.version || preflight.version, ...flags];
  else runtimeArgs = [normalizedType, 'install', `${parsed.id}@${preflight.version}`, ...flags];
  await runLegacy(runtimeArgs, ctx.file, approved);
  console.log('Install/update completed. Restart the client manually to activate changes.');
}

async function repairPackage(type, id, args) {
  if (!id) throw new Error('repair requires a package id');
  const normalizedType = assertPackageType(type);
  const runtime = await readRuntimeRegistry();
  const current = findRuntimePackage(runtime, id, { type: normalizedType });
  if (!current) throw new Error(`${normalizedType} is not installed: ${id}`);
  const spec = `${normalizedType}:${id}@${current.version}`;
  const { ctx, approved } = await approvedPreflight(normalizedType, spec, args);
  if (has(args, '--dry-run')) return;
  return runLegacy([normalizedType, 'repair', id], ctx.file, approved);
}

async function packageCommand(action, args) {
  if (action === 'init') {
    const result = await writeManifestTemplate(option(args, '--file', 'dsh-package.json'), option(args, '--type', 'plugin'), { id: option(args, '--id'), name: option(args, '--name') });
    return print(result);
  }
  const root = resolve(args[2] && !args[2].startsWith('--') ? args[2] : process.cwd());
  if (action === 'validate') {
    const found = await findPackageManifest(root);
    if (!found) throw new Error('no DSH package manifest found');
    print({ file: found.file, valid: found.valid, errors: found.errors, warnings: found.warnings, manifest: found.manifest });
    if (!found.valid) process.exitCode = 1;
    return;
  }
  if (action === 'audit') {
    const result = await auditPackageSecurity(root);
    print(result);
    if (!result.safe) process.exitCode = 1;
    return;
  }
  if (action === 'sbom') {
    const sbom = await generateSbom(root);
    const outputFile = resolve(args[3] || `${root}/sbom.cdx.json`);
    await writeFile(outputFile, `${JSON.stringify(sbom, null, 2)}\n`, 'utf8');
    return print({ generated: true, file: outputFile, components: sbom.components.length });
  }
  if (action === 'publish-check') {
    const found = await findPackageManifest(root);
    if (!found) throw new Error('no DSH package manifest found');
    const audit = await auditPackageSecurity(root);
    const security = found.manifest?.security || {};
    const missingEvidence = [];
    if (!security.provenance) missingEvidence.push('provenance');
    if (!security.signature) missingEvidence.push('signature');
    if (!security.sbom) missingEvidence.push('sbom');
    if (!security.license) missingEvidence.push('license');
    if (!found.manifest?.publisher?.id) missingEvidence.push('publisher.id');
    const result = {
      publishable: found.valid && audit.safe && missingEvidence.length === 0,
      manifest: { file: found.file, errors: found.errors, warnings: found.warnings },
      audit,
      missing_release_evidence: missingEvidence,
    };
    print(result);
    if (!result.publishable) process.exitCode = 1;
    return;
  }
  throw new Error(`unknown package action: ${action}`);
}

async function applyPackagePlan(kind, file, args) {
  if (!file) throw new Error(`${kind} requires a JSON file`);
  const result = await executePackageTransaction(file, {
    kind,
    catalog: option(args, '--registry', 'catalog/registry-v3.json'),
    approved: has(args, '--yes'),
    dryRun: has(args, '--dry-run'),
  });
  print(result);
}

async function bridgeCommand(action, args) {
  if (action === 'parse') return print(parseDshUrl(args[2]));
  if (action === 'register') return print(await registerProtocolHandler({ dryRun: has(args, '--dry-run') }));
  if (action === 'serve') {
    const host = await startClientHost({ port: option(args, '--port') });
    console.log(`DSH client host listening on http://${host.host}:${host.port}`);
    return;
  }
  if (action === 'link') {
    const type = assertPackageType(option(args, '--type', 'plugin'));
    const spec = parsePackageSpec(args[2], '*', type);
    return console.log(buildInstallDeepLink({ id: spec.id, version: spec.version, channel: option(args, '--channel'), type: spec.type, registry: option(args, '--registry') }));
  }
  if (action === 'handle') {
    const plan = deepLinkInstallPlan(args[2]);
    if (!has(args, '--yes')) {
      const approved = await confirm(`DSH Marketplace requests ${plan.request.action} of ${plan.request.type || 'plugin'}:${plan.request.id}@${plan.request.version}. Continue?`);
      if (!approved) return print({ ...plan, executed: false, reason: 'confirmation-required' });
      args = [...args, '--yes'];
    }
    const type = plan.request.type || 'plugin';
    const synthetic = [type, plan.request.action === 'update' ? 'update' : 'install', `${plan.request.id}@${plan.request.version}`, '--yes'];
    if (plan.request.channel) synthetic.push('--channel', plan.request.channel);
    if (plan.request.registry) synthetic.push('--registry', plan.request.registry);
    await installOrUpdate(type, plan.request.action === 'update' ? 'update' : 'install', `${plan.request.id}@${plan.request.version}`, synthetic);
    return;
  }
  throw new Error(`unknown bridge action: ${action}`);
}

async function ecosystemLifecycle(type, action, spec, args) {
  if (type === 'ecosystem') {
    if (!['list', 'status'].includes(action)) throw new Error(`ecosystem ${action} requires an explicit package type`);
    const runtimeArgs = ['package', action];
    if (spec) runtimeArgs.push(spec);
    if (has(args, '--all')) runtimeArgs.push('--all');
    return runLegacy(runtimeArgs);
  }
  const normalizedType = assertPackageType(type);
  if (action === 'install' || action === 'add' || action === 'update') return installOrUpdate(normalizedType, action === 'add' ? 'install' : action, spec, args);
  if (action === 'repair') return repairPackage(normalizedType, spec, args);
  const runtimeArgs = [normalizedType, action, ...stripFlag(args.slice(2), '--yes')];
  return runLegacy(runtimeArgs, undefined, has(args, '--yes'));
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  if (command === 'help' || command === '--help' || command === '-h') return help();
  if (command === 'version' || command === '--version' || command === '-v') return print(versionInfo());
  if (command === 'preflight') {
    const ctx = await registryContext(args);
    const runtimeRegistry = await readRuntimeRegistry();
    return print(preflightPackage(ctx.registry, args[1], { type: option(args, '--type'), channel: option(args, '--channel'), installed: runtimeRegistry.packages }));
  }
  if (command === 'bridge') return bridgeCommand(args[1] || 'parse', args);
  if (command === 'package') return packageCommand(args[1] || 'validate', args);
  if (command === 'profile' && args[1] === 'apply') return applyPackagePlan('profile', args[2], args);
  if (command === 'bundle' && args[1] === 'install') return applyPackagePlan('bundle', args[2], args);
  if (ECOSYSTEM_TYPES.has(command) || command === 'ecosystem') return ecosystemLifecycle(command, args[1] || 'list', args[2], args);
  if (command === 'install') return installOrUpdate('plugin', 'install', args[1], ['plugin', 'install', ...args.slice(1)]);
  if (MUTATING_ACTIONS.has(command)) throw new Error(`unsupported top-level mutation: ${command}`);
  return runLegacy(args);
}

main().catch((error) => {
  console.error(`[dsh] ${error.stack || error.message}`);
  if (error.permissionReport) console.error(JSON.stringify(error.permissionReport, null, 2));
  if (error.compatibilityReport) console.error(JSON.stringify(error.compatibilityReport, null, 2));
  process.exit(1);
});
